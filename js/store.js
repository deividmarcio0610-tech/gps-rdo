/* Persistência local — chave `rdo_digital_db_v1` conforme especificação. */
window.Store = (() => {
  'use strict';

  const KEY = 'rdo_digital_db_v1';
  // conta logada: cada uma tem os seus RDOs neste aparelho (chave rdo_digital_db_v1:<id>).
  // Sem conta, fica a chave antiga, para os RDOs que já estavam no aparelho não sumirem.
  let contaId = null;
  const chave = () => (contaId ? `${KEY}:${contaId}` : KEY);
  // qual conta ficou com os RDOs que já estavam no aparelho antes de existir conta
  const CHAVE_ADOCAO = `${KEY}:adotado_por`;

  /** Outra conta que já tem RDOs guardados neste aparelho ('' se não houver). */
  function outraContaNoAparelho() {
    try {
      for (let i = 0; i < (localStorage.length || 0); i += 1) {
        const k = localStorage.key(i) || '';
        if (!k.startsWith(`${KEY}:`) || k === CHAVE_ADOCAO || k.endsWith(':rev')) continue;
        const id = k.slice(KEY.length + 1);
        if (id && id !== contaId) return id;
      }
    } catch { /* aparelho sem acesso à lista de chaves: segue como se não houvesse outra */ }
    return '';
  }

  /*
   * Etapas do dia, na ordem do formulário "RDO ADM" do cliente (modelo de 09/11/2026).
   * Só as horas mudam de um dia para o outro; os nomes são fixos.
   */
  const ETAPAS = [
    'DSS:',
    'VESTIÁRIO / TROCA DE ROUPA:',
    'RECEBIMENTO DE OM, ASSINATURA DE DSS E EMOCIOGRAMA:',
    'PREPARAÇÃO DE FERRAMENTAS, MATERIAIS E DOCUMENTAÇÕES DE SEGURANÇA',
    'DESLOCAMENTO PARA O LOCAL DE TRABALHO:',
    'PREENCHIMENTO DE DOCUMENTAÇÕES DE SEGURANÇA: ART, CHECK LIST DE FERRAMENTAS E EQUIPAMENTOS',
    'INICIO DE EXECUÇÃO DA ATIVIDADE:',
    'HORÁRIO DE ALMOÇO/JANTA',
  ];
  /*
   * Horários fixos da grade do modelo "RDO ADM" do cliente (conferidos na planilha, L8:M15).
   * Desde 10/11/2026 a tela Etapas do Dia já abre com eles; o RDO guarda o que for salvo lá,
   * e a etapa que ficou em branco vale por estes valores.
   */
  const HORAS_MODELO = [
    ['07:45', '08:00'], ['08:00', '08:05'], ['08:05', '08:15'], ['08:15', '09:25'],
    ['09:25', '09:27'], ['09:27', '09:30'], ['09:30', '15:30'], ['11:00', '12:00'],
  ];
  const etapasVazias = () => ETAPAS.map(() => ({ inicio: '', fim: '' }));

  // Etapa 7 da lista (posição 6): a execução da atividade. É do fim dela que sai o tempo de bloqueio.
  const ETAPA_EXECUCAO = 6;

  /**
   * Horas de cada etapa como valem no RDO: o que foi digitado ou, na etapa que ficou em
   * branco, o horário fixo do modelo do cliente (pedido de 10/11/2026: a tela Etapas do Dia
   * já vem com esses valores). Aqui ainda não entra o desconto do bloqueio.
   */
  function etapasDoRdo(rdo) {
    const guardadas = Array.isArray(rdo?.etapas) ? rdo.etapas : [];
    return ETAPAS.map((_, i) => {
      const inicio = String(guardadas[i]?.inicio || '');
      const fim = String(guardadas[i]?.fim || '');
      return inicio || fim ? { inicio, fim } : { inicio: HORAS_MODELO[i][0], fim: HORAS_MODELO[i][1] };
    });
  }

  /**
   * A conta do bloqueio (pedido de 10/11/2026: lançado em Etapas do Dia, o desconto é
   * automático e a hora tem de bater). O tempo parado sai do fim da execução:
   *   fim com desconto = início da execução + (duração da execução − duração do bloqueio)
   * Vale para turno que vira a meia-noite, na execução e no bloqueio.
   * Devolve null quando o bloqueio não tem as duas horas. `cabe` é falso quando o bloqueio é
   * maior que a execução; `execucao` é null quando a execução não tem as duas horas (aí não
   * há de onde descontar e `fimAjustado` repete o fim informado).
   */
  function contaDoBloqueio(inicioExecucao, fimExecucao, bloqueio) {
    const b = bloqueio || {};
    const bi = minutosDe(b.inicio);
    const bf = minutosDe(b.fim);
    if (bi == null || bf == null || bi === bf) return null;
    const minutos = bf > bi ? bf - bi : bf + 1440 - bi;
    const conta = {
      inicio: hhmmDe(bi),
      fim: hhmmDe(bf),
      motivo: String(b.motivo || '').trim(),
      minutos,
      baseFim: String(fimExecucao || ''),
      fimAjustado: String(fimExecucao || ''),
      execucao: null,
      cabe: true,
    };
    const ini = minutosDe(inicioExecucao);
    const fim = minutosDe(fimExecucao);
    if (ini == null || fim == null) return conta;
    const execucao = fim >= ini ? fim - ini : fim + 1440 - ini;
    conta.execucao = execucao;
    conta.cabe = minutos <= execucao;
    conta.fimAjustado = hhmmDe(ini + Math.max(0, execucao - minutos));
    return conta;
  }

  /** Bloqueio do RDO com a conta feita contra a execução dele (null se não há bloqueio). */
  function bloqueioDoRdo(rdo) {
    const execucao = etapasDoRdo(rdo)[ETAPA_EXECUCAO];
    return contaDoBloqueio(execucao.inicio, execucao.fim, rdo?.bloqueio);
  }

  /** Etapas para os relatórios: as horas do RDO e, havendo bloqueio, o fim da execução já descontado. */
  function etapasComDesconto(rdo) {
    const etapas = etapasDoRdo(rdo);
    const conta = contaDoBloqueio(etapas[ETAPA_EXECUCAO].inicio, etapas[ETAPA_EXECUCAO].fim, rdo?.bloqueio);
    if (conta) etapas[ETAPA_EXECUCAO] = { inicio: etapas[ETAPA_EXECUCAO].inicio, fim: conta.fimAjustado };
    return etapas;
  }

  /** Frase do bloqueio para as observações do RDO Final ('' quando não há bloqueio). */
  function fraseDoBloqueio(conta) {
    if (!conta) return '';
    return `Parado por espera no bloqueio das ${conta.inicio} às ${conta.fim} (${fmtHoras(conta.minutos)})${conta.motivo ? ` — ${conta.motivo}` : ''}.`;
  }

  /*
   * Equipe fixa (pedido do usuário em 07/11/2026): aparece sempre para escolher na Mão de
   * Obra e não sai do cadastro. Ninguém entra no RDO sozinho: quem preenche marca os presentes.
   * Gente a mais fica em `employees`, no aparelho.
   */
  const EQUIPE_FIXA = [
    { equipe: 'Equipe 1', nomes: ['Joao', 'Lucas', 'Danilo', 'Gerson', 'Jean', 'Vinicius', 'Luiz Fernando'] },
    { equipe: 'Equipe 2', nomes: ['Diego', 'Diemerson', 'Irlan', 'Anderson', 'Everton', 'Valdir', 'Claudiney'] },
  ];

  // Nada vem preenchido no RDO: sem equipamentos, contrato ou empresa de exemplo.
  // Tudo o que aparece no RDO é escolhido ou digitado por quem preenche.
  const seed = () => ({
    config: { companyName: '', logoUrl: '', darkMode: false },
    rdos: [],
    // maior número já dado em cada dia (AAAAMMDD → NN): apagar um RDO não libera o número dele
    ultimos: {},
    employees: [],  // gente acrescentada pelo usuário além da equipe fixa: { id, name, team, role }
    equipment: [],
    contracts: [],
  });

  /*
   * Versões antigas gravavam no aparelho um cadastro de exemplo (pessoas, equipamentos,
   * "Contrato Mina Norte", "Mineração Brasil S.A.") e rascunhos com turno A, Sol e
   * 07:00–17:00 já marcados. Ao abrir, isso sai. RDOs com conteúdo não são tocados.
   */
  const EXEMPLO = new Set([
    'e1:Carlos Silva', 'e2:João Santos', 'e3:Pedro Oliveira', 'e4:Lucas Lima',
    'eq1:Escavadeira Hidráulica', 'eq2:Gerador 50kVA', 'eq3:Compressor Ar',
    'c1:Contrato Mina Norte',
  ]);
  const semExemplo = (lista) => (Array.isArray(lista) ? lista : [])
    .filter((x) => !EXEMPLO.has(`${x?.id}:${x?.name}`));

  /** Rascunho nunca preenchido: limpa os valores que a versão antiga marcava sozinha. */
  function limparRascunhoAntigo(r) {
    const vazio = r && r.status === 'draft' && !r.supervisor && !r.notes && !r.location && !r.maintenanceType
      && ['workforce', 'equipmentList', 'tasks', 'occurrences', 'stoppages', 'photos'].every((k) => !r[k]?.length);
    if (!vazio) return r;
    const padroes = { shift: 'A', weather: 'Sol', startTime: '07:00', endTime: '17:00', contractId: 'c1', contractName: 'Contrato Mina Norte' };
    for (const [k, v] of Object.entries(padroes)) if (r[k] === v) r[k] = '';
    return r;
  }

  let db = read();

  /*
   * Mais de uma aba: Gerar Relatório e Controle de RDO abrem em aba própria, e cada aba tem a
   * sua cópia dos RDOs na memória. Sem cuidado, a aba que ficou para trás gravava a cópia
   * velha por cima do que a outra tinha acabado de salvar. Cada gravação troca este carimbo;
   * quem vai mexer confere o carimbo antes e, se outra aba gravou, relê do aparelho primeiro.
   */
  const chaveRev = () => `${chave()}:rev`;
  const lerRev = () => {
    try { return localStorage.getItem(chaveRev()) || ''; } catch { return ''; }
  };
  let revVista = lerRev();

  /** Outra aba gravou depois desta? Relê os dados do aparelho. Devolve true se releu. */
  function recarregarSeMudou() {
    const rev = lerRev();
    if (rev === revVista) return false;
    revVista = rev;
    db = read();
    return true;
  }

  /**
   * Quem lançou o RDO: só nome, função e e-mail. A foto do rosto e a assinatura ficam na
   * conta, uma vez só. Antes iam copiadas dentro de cada RDO (50 a 100 KB cada): com poucas
   * dezenas de RDOs o aparelho enchia e o app parava de gravar.
   */
  function enxugar(r) {
    if (r && r.autor && typeof r.autor === 'object') {
      r.autor = {
        nome: String(r.autor.nome || ''),
        funcao: String(r.autor.funcao || ''),
        email: String(r.autor.email || ''),
      };
    }
    return r;
  }

  /**
   * Completa um RDO vindo do aparelho ou do banco com o que a versão antiga não tinha:
   * etapas do dia sempre com as 8 linhas certas e os campos do cabeçalho como texto.
   */
  function completo(r) {
    const x = enxugar({ stoppages: [], ...r });
    // listas sempre como lista: um RDO torto vindo do banco não derruba as telas
    for (const k of ['workforce', 'equipmentList', 'tasks', 'occurrences', 'stoppages', 'photos']) {
      if (!Array.isArray(x[k])) x[k] = [];
    }
    const guardadas = Array.isArray(x.etapas) ? x.etapas : [];
    x.etapas = ETAPAS.map((_, i) => ({ inicio: '', fim: '', ...(guardadas[i] || {}) }));
    // Bloqueio do dia, lançado em Etapas do Dia: { inicio, fim, motivo }. O fim da execução
    // com o desconto não é guardado: é sempre calculado (contaDoBloqueio), para a hora não
    // ficar descontada duas vezes nem velha depois de uma edição.
    const bq = x.bloqueio && typeof x.bloqueio === 'object'
      ? { inicio: String(x.bloqueio.inicio || ''), fim: String(x.bloqueio.fim || ''), motivo: String(x.bloqueio.motivo || '') }
      : null;
    x.bloqueio = bq && (bq.inicio || bq.fim || bq.motivo) ? bq : null;
    for (const k of ['cliente', 'complexo', 'gerencia', 'equipeCoord', 'objeto', 'contractName', 'location', 'maintenanceType', 'shift', 'weather', 'startTime', 'endTime', 'supervisor', 'tst', 'notes']) {
      if (typeof x[k] !== 'string') x[k] = '';
    }
    return x;
  }

  function read() {
    const base = seed();
    try {
      const raw = localStorage.getItem(chave());
      if (!raw) return base;
      const parsed = JSON.parse(raw);
      const config = { ...base.config, ...(parsed.config || {}) };
      if (config.companyName === 'Mineração Brasil S.A.') config.companyName = '';
      return {
        ...base,
        ...parsed,
        config,
        // RDO de versão anterior não tem horas paradas: começa com a lista vazia
        rdos: Array.isArray(parsed.rdos) ? parsed.rdos.map((r) => completo(limparRascunhoAntigo(r))) : [],
        ultimos: parsed.ultimos && typeof parsed.ultimos === 'object' ? parsed.ultimos : {},
        employees: semExemplo(parsed.employees),
        equipment: semExemplo(parsed.equipment),
        contracts: semExemplo(parsed.contracts),
      };
    } catch {
      return base;
    }
  }

  function save() {
    const novaRev = `${Date.now().toString(36)}-${uid()}`;
    try {
      // o carimbo vai antes: se os dados não couberem, as outras abas só releem à toa
      localStorage.setItem(chaveRev(), novaRev);
      localStorage.setItem(chave(), JSON.stringify(db));
    } catch {
      return false;
    }
    revVista = novaRev;
    // com conta na central, o que foi gravado sobe sozinho quando houver internet
    window.Conta?.agendar?.();
    return true;
  }

  // 9 caracteres em base36. Math.random().toString(36) às vezes devolve menos casas
  // (número "redondo"), e o id saía curto; aqui o tamanho é sempre o mesmo.
  const ALFABETO = '0123456789abcdefghijklmnopqrstuvwxyz';
  function uid() {
    const bytes = new Uint8Array(9);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => ALFABETO[b % 36]).join('');
  }

  /** AAAAMMDD-NN, contador por dia. Conta também números de RDOs já apagados. */
  function nextNumber(dateIso) {
    const dia = String(dateIso || todayIso()).slice(0, 10).replace(/-/g, '');
    const usados = db.rdos
      .filter((r) => String(r.number || '').startsWith(`${dia}-`))
      .map((r) => Number(String(r.number).split('-')[1]))
      .filter((n) => Number.isInteger(n));
    const proximo = Math.max(0, ...usados, Number(db.ultimos?.[dia]) || 0) + 1;
    return `${dia}-${String(proximo).padStart(2, '0')}`;
  }

  /** Guarda o número como já dado no dia dele, para não repetir depois de apagar. */
  function marcarNumero(numero) {
    const [dia, seq] = String(numero || '').split('-');
    const n = Number(seq);
    if (!dia || !Number.isInteger(n)) return;
    db.ultimos = db.ultimos || {};
    db.ultimos[dia] = Math.max(Number(db.ultimos[dia]) || 0, n);
  }

  function todayIso() {
    const d = new Date();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
  }

  function emptyRdo() {
    const agora = new Date();
    const data = todayIso();
    return {
      id: uid(),
      number: nextNumber(data),
      date: data,
      status: 'draft',
      // só número e data saem sozinhos; o resto começa vazio e é digitado
      contractId: '',
      contractName: '',  // Contrato (nº), como no formulário do cliente
      cliente: '',
      complexo: '',
      gerencia: '',
      equipeCoord: '',  // EQUIPE / COORDENAÇÃO
      objeto: '',
      etapas: etapasVazias(),  // horas de início e fim de cada etapa do dia
      bloqueio: null,  // { inicio, fim, motivo }, lançado em Etapas do Dia
      location: '',  // local / mina digitado à mão no cabeçalho
      maintenanceType: '',  // Preventiva, Corretiva ou Backlog (escolhido no cabeçalho)
      shift: '',
      weather: '',
      startTime: '',
      endTime: '',
      supervisor: '',
      tst: '',
      notes: '',
      createdAt: agora.toISOString(),
      atualizado: Date.now(),  // quando mudou aqui: é o que decide quem vence na troca com o banco
      workforce: [],
      equipmentList: [],
      tasks: [],
      occurrences: [],
      stoppages: [],  // horas paradas: { id, start, end, reason, note }
      photos: [],
    };
  }

  /** HH:MM → minutos do dia (null quando não é hora). */
  function minutosDe(hhmm) {
    const [h, m] = String(hhmm || '').split(':').map(Number);
    // hora fora de 00:00–23:59 (dado torto vindo do banco) não é hora
    return Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59 ? h * 60 + m : null;
  }

  /** Minutos de uma parada (HH:MM → HH:MM); passa da meia-noite se o fim for menor. */
  function minutosParada(p) {
    const ini = minutosDe(p?.start);
    const fim = minutosDe(p?.end);
    if (ini == null || fim == null) return 0;
    return fim >= ini ? fim - ini : fim + 1440 - ini;
  }

  /** Minutos do dia → HH:MM; dá a volta no dia em vez de passar de 23:59. */
  function hhmmDe(minutos) {
    const n = ((Math.round(Number(minutos) || 0) % 1440) + 1440) % 1440;
    return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  }

  /** 90 → "1h30", 45 → "0h45". */
  const fmtHoras = (minutos) => `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, '0')}`;

  return {
    get all() { return db; },
    get config() { return db.config; },
    get employees() { return db.employees; },
    get equipment() { return db.equipment; },
    get contracts() { return db.contracts; },
    get rdos() { return db.rdos; },

    uid,
    ETAPAS,
    HORAS_MODELO,
    ETAPA_EXECUCAO,
    etapasDoRdo,
    contaDoBloqueio,
    bloqueioDoRdo,
    etapasComDesconto,
    fraseDoBloqueio,
    completo,
    todayIso,
    minutosDe,
    minutosParada,
    hhmmDe,
    fmtHoras,
    nextNumber,
    emptyRdo,
    save,

    recarregarSeMudou,

    setDarkMode(on) {
      recarregarSeMudou();
      db.config.darkMode = Boolean(on);
      save();
    },

    /** Modo campo: letra e botões maiores, mais contraste (sol, luva). */
    setModoCampo(on) {
      recarregarSeMudou();
      db.config.modoCampo = Boolean(on);
      save();
    },

    /**
     * Cria um RDO já persistido (botão Novo RDO). Guarda quem lançou (nome, função e
     * e-mail da conta); a foto do rosto e a assinatura ficam só na conta.
     */
    createRdo() {
      recarregarSeMudou();
      const rdo = emptyRdo();
      const conta = window.Conta?.usuario?.() || null;
      if (conta) {
        rdo.autor = {
          nome: conta.nome || '',
          funcao: conta.funcao || '',
          email: conta.email || '',
        };
      }
      marcarNumero(rdo.number);
      db.rdos.unshift(rdo);
      // save() já agenda o envio para o banco
      if (!save()) {
        // não coube: o RDO não fica só na memória para sumir ao reabrir
        db.rdos = db.rdos.filter((r) => r.id !== rdo.id);
        return null;
      }
      return rdo;
    },

    find(id) { return db.rdos.find((r) => r.id === id) || null; },
    get recentes() { return db.rdos.slice(0, 3); },

    /** Equipe para escolher na Mão de Obra: os fixos de cada equipe e os acrescentados no aparelho. */
    get equipe() {
      const grupos = EQUIPE_FIXA.map((g) => ({
        equipe: g.equipe,
        pessoas: g.nomes.map((name) => ({ name, team: g.equipe, role: '', fixa: true })),
      }));
      (db.employees || []).forEach((e) => {
        const nomeEquipe = e.team || 'Outros';
        let g = grupos.find((x) => x.equipe === nomeEquipe);
        if (!g) { g = { equipe: nomeEquipe, pessoas: [] }; grupos.push(g); }
        g.pessoas.push({ id: e.id, name: e.name, team: nomeEquipe, role: e.role || '', fixa: false });
      });
      return grupos;
    },

    /** Acrescenta alguém à equipe (fica no aparelho). Devolve false se já existe na mesma equipe. */
    adicionarPessoa(name, team, role = '') {
      recarregarSeMudou();
      const nome = String(name || '').trim();
      const equipe = String(team || '').trim() || 'Outros';
      if (!nome) return false;
      const igual = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
      const grupo = this.equipe.find((g) => igual(g.equipe, equipe));
      if (grupo?.pessoas.some((p) => igual(p.name, nome))) return false;
      db.employees = db.employees || [];
      db.employees.push({ id: uid(), name: nome, team: grupo?.equipe || equipe, role: String(role || '').trim() });
      return save();
    },

    /** Tira do cadastro alguém acrescentado. A equipe fixa não sai. */
    removerPessoa(id) {
      recarregarSeMudou();
      const antes = (db.employees || []).length;
      db.employees = (db.employees || []).filter((e) => e.id !== id);
      return db.employees.length < antes && save();
    },

    /** Número novo para outra data (a data do cabeçalho mudou): o número sempre acompanha a data. */
    numeroPara(dataIso) {
      const numero = nextNumber(dataIso);
      marcarNumero(numero);
      return numero;
    },

    /**
     * Apaga o RDO de vez, com as fotos. Não há lixeira.
     * `soLocal`: tira só a cópia deste aparelho e deixa o banco como está (a conta principal
     * usa para limpar do aparelho dela o RDO de outra pessoa, sem apagar o RDO da pessoa).
     */
    remove(id, { soLocal = false } = {}) {
      recarregarSeMudou();
      const rdo = db.rdos.find((r) => r.id === id);
      if (!rdo) return false;
      const antes = { rdos: db.rdos, ultimos: { ...(db.ultimos || {}) } };
      marcarNumero(rdo.number);
      db.rdos = db.rdos.filter((r) => r.id !== id);
      if (!save()) {
        // não gravou: o RDO continua no aparelho, então fotos e banco ficam como estão
        db.rdos = antes.rdos;
        db.ultimos = antes.ultimos;
        return false;
      }
      window.Fotos?.remover(rdo.photos);
      // apagado no aparelho, sai do banco na nuvem também (o dono ou a conta principal)
      if (!soLocal) window.Conta?.apagarNaNuvem?.(rdo);
      return true;
    },

    /**
     * Restaura RDOs de uma cópia de segurança. RDO que já existe aqui (mesmo id) fica como
     * está; os outros entram. Devolve quantos entraram ou -1 se não coube.
     */
    importar(rdos, ultimos = {}) {
      recarregarSeMudou();
      const antes = { rdos: db.rdos.slice(), ultimos: { ...(db.ultimos || {}) } };
      const novos = (Array.isArray(rdos) ? rdos : [])
        .filter((r) => r && r.id && !db.rdos.some((x) => x.id === r.id))
        .map((r) => completo({ atualizado: Date.now(), ...r }));
      db.rdos.push(...novos);
      db.rdos.sort((a, b) => String(b.number).localeCompare(String(a.number)));
      Object.entries(ultimos || {}).forEach(([dia, n]) => marcarNumero(`${dia}-${n}`));
      novos.forEach((r) => marcarNumero(r.number));
      if (save()) {
        if (novos.length) window.Conta?.agendar?.();
        return novos.length;
      }
      db.rdos = antes.rdos;
      db.ultimos = antes.ultimos;
      return -1;
    },

    /** Números de uma lista de RDOs (resumo do mês). */
    resumo(lista) {
      const tipos = () => ({ Preventiva: 0, Corretiva: 0, Backlog: 0 });
      const r = {
        total: lista.length, finalizados: 0, porTipo: tipos(), tarefasPorTipo: tipos(), tarefas: 0, concluidas: 0,
        backlogAberto: 0, horasEquipe: 0, minutosParados: 0, ocorrencias: 0, fotos: 0, motivosParada: [],
      };
      const motivos = new Map();
      lista.forEach((x) => {
        if (x.status === 'final') r.finalizados += 1;
        if (x.maintenanceType in r.porTipo) r.porTipo[x.maintenanceType] += 1;
        (x.tasks || []).forEach((t) => {
          r.tarefas += 1;
          if ((Number(t.progress) || 0) >= 100) r.concluidas += 1;
          if (t.maintenanceType in r.tarefasPorTipo) r.tarefasPorTipo[t.maintenanceType] += 1;
          if (t.maintenanceType === 'Backlog' && (Number(t.progress) || 0) < 100) r.backlogAberto += 1;
        });
        (x.workforce || []).filter((w) => w.status === 'Presente').forEach((w) => { r.horasEquipe += Number(w.hours) || 0; });
        (x.stoppages || []).forEach((p) => {
          const m = minutosParada(p);
          r.minutosParados += m;
          motivos.set(p.reason, (motivos.get(p.reason) || 0) + m);
        });
        r.ocorrencias += (x.occurrences || []).length;
        r.fotos += (x.photos || []).length;
      });
      r.motivosParada = [...motivos.entries()].sort((a, b) => b[1] - a[1]);
      return r;
    },

    /** Tamanho aproximado dos dados salvos, em bytes (as fotos pesam quase tudo). */
    tamanho() {
      try { return (localStorage.getItem(chave()) || '').length; } catch { return 0; }
    },

    get contaId() { return contaId; },

    /**
     * Passa a usar os dados de uma conta (ou os do modo sem conta, com '').
     * Na primeira vez desta conta no aparelho, os RDOs que já estavam aqui (da chave antiga)
     * passam a ser dela: foram digitados neste telefone por esta pessoa.
     */
    usarConta(id) {
      const novo = id ? String(id) : '';
      if (novo === (contaId || '')) return;
      contaId = novo || null;
      // Os RDOs que já estavam no aparelho (de antes das contas) passam para UMA conta só: a
      // primeira que entrar. Antes, toda conta nova que entrasse neste aparelho levava uma
      // cópia deles e mandava para o banco como se fossem dela.
      let adotante = false;
      if (contaId) {
        try {
          let dono = localStorage.getItem(CHAVE_ADOCAO);
          const antiga = localStorage.getItem(KEY);
          if (!dono && antiga) {
            // aparelho de antes desta marca: quem já tem dados aqui adotou naquela época
            const propria = localStorage.getItem(chave());
            dono = propria ? contaId : (outraContaNoAparelho() || contaId);
            if (dono === contaId && !propria) localStorage.setItem(chave(), antiga);
            localStorage.setItem(CHAVE_ADOCAO, dono);
          }
          adotante = dono === contaId;
        } catch { /* sem espaço para copiar: começa vazio, os RDOs seguem na chave antiga */ }
      }
      db = read();
      revVista = lerRev();
      // as fotos seguem a mesma conta: cada banco do IndexedDB é de um dono só
      window.Fotos?.usarConta?.(contaId || '', { adotar: adotante });
    },

    /**
     * Anota no RDO algo que só interessa a este aparelho (campos com "_" na frente, que não
     * sobem para o banco). Não mexe no carimbo: a anotação não conta como edição do RDO.
     */
    anotar(id, campos) {
      recarregarSeMudou();
      const rdo = db.rdos.find((r) => r.id === id);
      if (!rdo) return false;
      Object.assign(rdo, campos);
      return save();
    },

    /** Salva alterações de um RDO; devolve false quando a cota estoura. */
    update(id, mutate) {
      recarregarSeMudou();
      const i = db.rdos.findIndex((r) => r.id === id);
      if (i < 0) return false;
      const antes = JSON.stringify(db.rdos[i]);
      const carimbo = db.rdos[i].atualizado;
      try {
        mutate(db.rdos[i]);
      } catch {
        // a alteração quebrou no meio (item que sumiu, dado torto): nada fica pela metade
        db.rdos[i] = JSON.parse(antes);
        return false;
      }
      enxugar(db.rdos[i]);
      // quem mexeu de verdade carimba a hora; quem só trouxe uma versão do banco mantém a dele
      // O carimbo nunca anda para trás: se a versão anterior veio de um aparelho com o relógio
      // adiantado, "agora" seria menor que o carimbo dela e a edição daqui nunca subiria.
      if (db.rdos[i].atualizado === carimbo) db.rdos[i].atualizado = Math.max(Date.now(), (Number(carimbo) || 0) + 1);
      // save() já agenda o envio; o que veio do banco tem o carimbo do banco e não volta para lá
      if (save()) return true;
      // cota estourou: desfaz também na memória. Antes a alteração ficava só na tela,
      // sumia ao reabrir e travava a gravação de tudo o que viesse depois.
      db.rdos[i] = JSON.parse(antes);
      return false;
    },
  };
})();
