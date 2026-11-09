/* Persistência local — chave `rdo_digital_db_v1` conforme especificação. */
window.Store = (() => {
  'use strict';

  const KEY = 'rdo_digital_db_v1';
  // conta logada: cada uma tem os seus RDOs neste aparelho (chave rdo_digital_db_v1:<id>).
  // Sem conta, fica a chave antiga, para os RDOs que já estavam no aparelho não sumirem.
  let contaId = null;
  const chave = () => (contaId ? `${KEY}:${contaId}` : KEY);

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
  const etapasVazias = () => ETAPAS.map(() => ({ inicio: '', fim: '' }));

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

  /**
   * Completa um RDO vindo do aparelho ou do banco com o que a versão antiga não tinha:
   * etapas do dia sempre com as 8 linhas certas e os campos do cabeçalho como texto.
   */
  function completo(r) {
    const x = { stoppages: [], ...r };
    const guardadas = Array.isArray(x.etapas) ? x.etapas : [];
    x.etapas = ETAPAS.map((_, i) => ({ inicio: '', fim: '', ...(guardadas[i] || {}) }));
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
    try {
      localStorage.setItem(chave(), JSON.stringify(db));
    } catch {
      return false;
    }
    // com conta na central, o que foi gravado sobe sozinho quando houver internet
    window.Conta?.agendar?.();
    return true;
  }

  const uid = () => Math.random().toString(36).slice(2, 11);

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

  /** Minutos de uma parada (HH:MM → HH:MM); passa da meia-noite se o fim for menor. */
  function minutosParada(p) {
    const min = (hhmm) => {
      const [h, m] = String(hhmm || '').split(':').map(Number);
      return Number.isInteger(h) && Number.isInteger(m) ? h * 60 + m : null;
    };
    const ini = min(p?.start);
    const fim = min(p?.end);
    if (ini == null || fim == null) return 0;
    return fim >= ini ? fim - ini : fim + 1440 - ini;
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
    completo,
    todayIso,
    minutosParada,
    fmtHoras,
    nextNumber,
    emptyRdo,
    save,

    setDarkMode(on) {
      db.config.darkMode = Boolean(on);
      save();
    },

    /** Modo campo: letra e botões maiores, mais contraste (sol, luva). */
    setModoCampo(on) {
      db.config.modoCampo = Boolean(on);
      save();
    },

    /**
     * Cria um RDO já persistido (botão Novo RDO). A assinatura do formulário é a foto do
     * rosto da conta que preenche (cadastro): vai congelada no RDO, para o PDF e o
     * supervisor verem quem lançou.
     */
    createRdo() {
      const rdo = emptyRdo();
      const conta = window.Conta?.usuario?.() || null;
      if (conta) {
        rdo.autor = {
          nome: conta.nome || '',
          funcao: conta.funcao || '',
          email: conta.email || '',
          foto: conta.facial || '',
          // assinatura desenhada no cadastro: vai no campo "Ass:" do supervisor no PDF
          assinatura: conta.assinatura || '',
        };
      }
      marcarNumero(rdo.number);
      db.rdos.unshift(rdo);
      save();
      // com conta na central, o RDO novo sobe assim que houver rede
      window.Conta?.agendar?.();
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

    /** Apaga o RDO de vez, com as fotos. Não há lixeira. */
    remove(id) {
      const rdo = db.rdos.find((r) => r.id === id);
      if (!rdo) return false;
      marcarNumero(rdo.number);
      db.rdos = db.rdos.filter((r) => r.id !== id);
      window.Fotos?.remover(rdo.photos);
      // apagado no aparelho, sai do banco na nuvem também (o dono ou a conta principal)
      window.Conta?.apagarNaNuvem?.(rdo);
      window.Conta?.agendar?.();
      return save();
    },

    /**
     * Restaura RDOs de uma cópia de segurança. RDO que já existe aqui (mesmo id) fica como
     * está; os outros entram. Devolve quantos entraram ou -1 se não coube.
     */
    importar(rdos, ultimos = {}) {
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
      if (contaId) {
        try {
          const propria = localStorage.getItem(chave());
          const antiga = localStorage.getItem(KEY);
          if (!propria && antiga) localStorage.setItem(chave(), antiga);
        } catch { /* sem espaço para copiar: começa vazio, os RDOs seguem na chave antiga */ }
      }
      db = read();
      // as fotos seguem a mesma conta: cada banco do IndexedDB é de um dono só
      window.Fotos?.usarConta?.(contaId || '', { adotar: true });
    },

    /** Salva alterações de um RDO; devolve false quando a cota estoura. */
    update(id, mutate, { deBanco = false } = {}) {
      const i = db.rdos.findIndex((r) => r.id === id);
      if (i < 0) return false;
      const antes = JSON.stringify(db.rdos[i]);
      const carimbo = db.rdos[i].atualizado;
      mutate(db.rdos[i]);
      // quem mexeu de verdade carimba a hora; quem só trouxe uma versão do banco mantém a dele
      if (db.rdos[i].atualizado === carimbo) db.rdos[i].atualizado = Date.now();
      if (save()) {
        // veio do banco não volta para o banco (evita laço de subir o que acabou de descer)
        if (!deBanco) window.Conta?.agendar?.();
        return true;
      }
      // cota estourou: desfaz também na memória. Antes a alteração ficava só na tela,
      // sumia ao reabrir e travava a gravação de tudo o que viesse depois.
      db.rdos[i] = JSON.parse(antes);
      return false;
    },
  };
})();
