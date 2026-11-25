/*
 * Instalação: registra o service worker, guarda o convite de instalação do
 * Android/Chrome e mostra o passo a passo no iPhone, que não expõe evento.
 */
window.Pwa = (() => {
  'use strict';

  let convite = null;          // BeforeInstallPromptEvent (Android/Chrome)
  let registro = null;         // registro do service worker (para procurar versão nova)
  const ouvintes = [];

  // versão do código deste build; subir junto com o versionName do Gradle e com VERSAO do sw.js
  const VERSAO_APP = '1.15';
  const APK_URL = 'https://github.com/deividmarcio0610-tech/gps-rdo/releases/latest/download/GPS-RDO.apk';
  const NATIVO = () => Boolean(window.Capacitor?.isNativePlatform?.());

  const instalado = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const ehIOS = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ se apresenta como Mac com toque
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const ehAndroid = () => /android/i.test(navigator.userAgent);

  const notificar = () => ouvintes.forEach((f) => f());

  function registrar() {
    if (!('serviceWorker' in navigator)) return;
    // precisa de https ou localhost; em file:// não há service worker
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;

    // versão nova assumiu (site atualizado ou APK instalado por cima): recarrega uma vez para
    // não ficar mostrando a versão velha até a próxima abertura. Na primeira instalação não.
    const tinhaVersao = Boolean(navigator.serviceWorker.controller);
    let recarregou = false;
    // Recarregar apaga o que está digitado e não foi salvo (uma observação longa, o cadastro
    // com a assinatura desenhada). Se a pessoa está no meio disso, a troca espera ela terminar.
    const emUso = () => {
      if (document.querySelector('.scrim')) return true;
      const foco = document.activeElement;
      if (foco && /^(INPUT|TEXTAREA|SELECT)$/.test(foco.tagName)) return true;
      // cabeçalho e etapas só gravam no botão Salvar: enquanto a tela está aberta, espera
      if (document.querySelector('#screen fieldset.campos:not([disabled])')) return true;
      // tela de entrar/cadastro: só segura se já há algo digitado ou a assinatura desenhada
      const form = document.querySelector('#screen form[data-form]');
      if (!form) return false;
      return [...form.querySelectorAll('input')].some((i) => i.type !== 'file' && i.value)
        || Boolean(form.querySelector('canvas[data-vazia="0"]'));
    };
    const recarregarQuandoDer = () => {
      if (recarregou) return;
      if (emUso()) { mostrarFaixaAtualizacao(); setTimeout(recarregarQuandoDer, 3000); return; }
      recarregou = true;
      // depois de recarregar, o app avisa que se atualizou sozinho (avisarSeAtualizou)
      try { sessionStorage.setItem(CHAVE_ATUALIZOU, '1'); } catch { /* sem aviso, só isso */ }
      location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!tinhaVersao || recarregou) return;
      recarregarQuandoDer();
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        registro = reg;
        // quando houver versão nova, assume e recarrega (o app não fica na versão velha)
        reg.addEventListener('updatefound', () => {
          const novo = reg.installing;
          novo?.addEventListener('statechange', () => {
            if (novo.state !== 'installed') return;
            if (navigator.serviceWorker.controller) novo.postMessage('ativar-agora');
            notificar();
          });
        });
        // confere agora e logo depois: o primeiro load pode pegar o sw.js em cache do CDN
        checarAtualizacao();
        setTimeout(checarAtualizacao, 60 * 1000);
      }).catch(() => { /* sem service worker o app ainda abre, só não fica offline */ });
    });

    // versão nova publicada com o app aberto: confere ao voltar para ele, ao recuperar a
    // rede e de tempos em tempos (antes só conferia ao carregar a página, uma vez)
    const aoVoltar = () => { if (document.visibilityState === 'visible') checarAtualizacao(); };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', checarAtualizacao);
    window.addEventListener('online', checarAtualizacao);
    setInterval(checarAtualizacao, 5 * 60 * 1000);
  }

  /**
   * Botão "Atualizar o app" da tela inicial (pedido de 17/11/2026). No APK: confere a release
   * publicada e, havendo versão nova, abre o download (o Android pede um toque para instalar).
   * No navegador / tela de início: relê o sw.js; havendo versão nova ela entra e o app recarrega.
   */
  async function atualizarAgora() {
    const aviso = (t) => window.UI?.toast?.(t);
    if (!navigator.onLine) { aviso('Sem internet: conecte e toque de novo.'); return 'sem-rede'; }
    if (NATIVO()) {
      const nova = await versaoNovaDoApk();
      if (!nova) { aviso(`Você já está na última versão do app (${VERSAO_APP}).`); return 'em-dia'; }
      aviso(`Baixando a versão ${nova.versao}. Depois toque no arquivo para instalar por cima.`);
      window.open(nova.url, '_system');
      return 'baixando';
    }
    if (!registro) { location.reload(); return 'recarregado'; }
    aviso('Procurando versão nova...');
    try { await registro.update(); } catch { aviso('Não consegui conferir agora. Tente de novo.'); return 'erro'; }
    // achou: o service worker novo instala, assume e a página recarrega sozinha (controllerchange)
    const chegando = registro.installing || registro.waiting;
    if (chegando) {
      chegando.postMessage?.('ativar-agora');
      aviso('Versão nova encontrada. O app vai recarregar.');
      return 'atualizando';
    }
    aviso(`Você já está na última versão${await versaoDoSite().then((v) => (v ? ` (${v})` : ''))}.`);
    return 'em-dia';
  }

  /** Pede ao navegador para reler o sw.js; havendo versão nova, ela entra e a página recarrega. */
  function checarAtualizacao() {
    if (!registro || !navigator.onLine) return Promise.resolve(false);
    return registro.update().then(() => true).catch(() => false);
  }

  function escutarConvite() {
    window.addEventListener('beforeinstallprompt', (evento) => {
      evento.preventDefault();   // segura o mini-banner do Chrome
      convite = evento;
      notificar();
    });
    window.addEventListener('appinstalled', () => {
      convite = null;
      notificar();
    });
  }

  /** Há como instalar agora? (evento do Android ou instrução do iPhone) */
  function podeInstalar() {
    if (instalado()) return false;
    return Boolean(convite) || ehIOS();
  }

  async function instalar() {
    if (convite) {
      convite.prompt();
      const escolha = await convite.userChoice;
      const aceitou = escolha?.outcome === 'accepted';
      if (aceitou) convite = null;
      notificar();
      return aceitou ? 'instalado' : 'recusado';
    }
    return ehIOS() ? 'instrucoes-ios' : 'indisponivel';
  }

  const aoMudar = (f) => { ouvintes.push(f); };

  const CHAVE_ATUALIZOU = 'gps_rdo_atualizou_v1';

  /** Logo depois de o app se atualizar sozinho: avisa, com a versão que entrou. */
  /*
   * Notificação de atualização (pedido de 10/11/2026). O que mudou em cada atualização: aparece
   * uma vez, na primeira abertura depois que a versão nova entra (no navegador, na tela de
   * início ou no APK). Ao publicar uma versão com novidade, acrescente uma linha aqui.
   */
  // A v53 leva a v52 ao APK 1.14 e repete as novidades dela: a v52 ficou poucos minutos no
  // ar, e quem abre o app pula da v51 direto para a v53 (o aviso mostra só a versão que entrou).
  const NOVIDADES_V52 = [
    'Ocorrências agora se chamam Desvios, com os tipos Alteração na programação, Falta de material, Falta de mão de obra, Falta de tempo, Falta ou atraso de documento, Equipamento, Clima e Outro. Toque no desvio para corrigir.',
    'Relatório de Campo: bloco DESVIOS DO DIA logo depois do cabeçalho. No RDO Final os desvios vêm primeiro nas observações, e o resumo do WhatsApp também começa por eles.',
    'Foto da câmera: o PDF espera a foto que ainda está entrando, para ela não ficar fora do Relatório de Campo.',
  ];
  const NOVIDADES = {
    v54: [
      'Equipamentos: o botão Escolher da lista mostra as máquinas da lista do cliente, em grupos e com busca por frota, modelo ou TAG. Marque as do dia e toque em Adicionar marcados. Digitar outro continua para o que não está na lista.',
      'Máquina da lista pode ser salva só com o horímetro; o status fica para depois. O PDF e o WhatsApp mostram o nome e a TAG.',
      'Conta principal: tela Lista de Equipamentos, para importar a planilha (.xlsx). A planilha é lida no próprio aparelho, e vai para o banco só grupo, modelo, frota e TAG.',
    ],
    v53: [
      'APK 1.14: traz tudo da v50 à v52 (Envio Rápido ao Supervisor, Desvios, foto da câmera no Relatório de Campo).',
      ...NOVIDADES_V52,
    ],
    v52: [...NOVIDADES_V52],
    v50: [
      'Colaborador: quadradinho Envio Rápido ao Supervisor sobe o RDO para o banco e abre o resumo no WhatsApp do supervisor (o número fica guardado). Na conta principal o envio pelo WhatsApp segue em RDOs da Equipe, no relatório do dia ou do período.',
    ],
    v49: [
      'APK 1.13: traz tudo até a v48 (Análise e Galeria no topo do início, Resumo Rápido pelo WhatsApp).',
    ],
    v48: [
      'Início: quadradinho Resumo Rápido (WhatsApp) manda o texto do RDO aberto direto para o WhatsApp.',
    ],
    v47: [
      'Início: Análise dos RDOs subiu para o grupo de quadradinhos do topo, ao lado de Galeria de Fotos.',
    ],
    v46: [
      'APK 1.12: traz tudo da v42 à v45 (Controle de RDO por qualquer parte do nome, Galeria e Análise no início).',
    ],
    v45: [
      'Início: Análise dos RDOs virou um quadradinho, igual aos outros do painel.',
    ],
    v44: [
      'Início: a Galeria de Fotos fica ao lado de Fotos do RDO (saiu do fim da lista).',
    ],
    v43: [
      'Controle de RDO: qualquer parte do nome na Mão de Obra (primeiro, segundo ou terceiro nome) conta como feito. Quando o nome é só uma parte, tem grafia diferente ou serve para mais de uma conta, o cartão verde mostra "Conferir" com o nome como está no RDO.',
    ],
    v42: [
      'Controle de RDO: nome só com o primeiro nome na Mão de Obra conta como feito quando só uma conta tem esse nome; grafia diferente (Thiago/Tiago, Luiz/Luis, Rossi/Rosi) também conta. Quem ficar vermelho mostra o nome parecido achado no RDO para conferir.',
    ],
    v40: [
      'Controle de RDO: só fica verde quem tem o nome na Mão de Obra (sem Falta) de algum RDO do dia, o próprio ou o de outra pessoa.',
      'Análise: resumo em tópicos curtos, destaques (atividade mais rotineira, preventiva x corretiva, equipamento mais atendido, mão de obra do dia) e PDF do resumo.',
      'Fotos: ao anexar, escolha a atividade. A conta principal tem a Galeria de fotos, por dia e atividade, com botão para salvar no telefone.',
    ],
    v39: [
      'Controle de RDO: nome da Mão de Obra que serve para mais de uma conta não marca ninguém como entregue; Falta num RDO e presença em outro do mesmo dia conta pelo RDO em que a pessoa está presente.',
    ],
    v38: [
      'Controle de RDO: quem está na Mão de Obra do RDO de outra pessoa (sem Falta) já conta como entregue, com o nome de quem enviou.',
    ],
    v37: [
      'Botão "Atualizar o app" na tela inicial: confere e instala a versão nova na hora.',
      'Análise dos RDOs (conta principal): números de todos os RDOs da equipe, tarefas executadas e em andamento, equipamentos parados, horas paradas, ocorrências, por pessoa e por dia, com exportação para Excel.',
      'Nº do RDO muda na hora em que a data do cabeçalho é trocada.',
      'Nº da OS agora é obrigatório na tarefa.',
      'PDF com nome padrão: "RDO 20261028-01 - NOME - 28-10-2026".',
      'Assinatura acompanha o dedo mesmo quando a tela muda de tamanho.',
    ],
    v36: [
      'App Android 1.10: traz os relatórios novos (Relatório de Campo na folha do RDO Final com as fotos em anexo; RDO Final sem fotos).',
    ],
    v35: [
      'Relatório de Campo agora sai na mesma folha do RDO Final, com as fotos do campo em anexo logo depois.',
      'RDO Final sai sem fotos: as fotos vão só no Relatório de Campo.',
      'Blocos de OM sem linhas por dentro: a descrição corre livre, logo abaixo do título.',
      'Linhas dos horários mais baixas, com mais espaço para a descrição das OMs.',
    ],
    v34: [
      'Cadastro funciona sem internet: a conta é criada no aparelho e vai para o banco sozinha quando o sinal voltar.',
    ],
    v33: [
      'Horário ADM de todos: 07:30 às 16:30, com 1 hora de almoço, já preenchido em Etapas do Dia.',
      'Espera por bloqueio: lançada em Etapas do Dia, o tempo sai sozinho do fim da execução.',
      'Tela de entrar e de cadastro mais fáceis (mostrar a senha, cadastro em 3 passos).',
      'O app avisa quando se atualiza e, no Android, quando há versão nova para instalar.',
    ],
  };
  const CHAVE_VISTA = 'gps_rdo_versao_vista_v1';

  /** Versão ("v33") escrita no sw.js que acompanha este app; '' se não der para ler. */
  async function versaoDoArquivo() {
    try {
      const r = await fetch('sw.js', { cache: 'no-store' });
      const m = /gps-rdo-(v\d+)/.exec(await r.text());
      return m ? m[1] : '';
    } catch { return ''; }
  }

  /** Faixa no alto da tela: versão nova pronta, esperando a pessoa terminar o que digita. */
  function mostrarFaixaAtualizacao() {
    if (document.getElementById('faixa-atualizacao')) return;
    const faixa = document.createElement('div');
    faixa.id = 'faixa-atualizacao';
    faixa.className = 'faixa-atualizacao';
    faixa.setAttribute('role', 'status');
    faixa.innerHTML = '<span>Versão nova do app pronta. Salve o que está fazendo; o app se atualiza sozinho.</span>'
      + '<button type="button" class="btn primary">Atualizar agora</button>';
    faixa.querySelector('button').addEventListener('click', () => {
      try { sessionStorage.setItem(CHAVE_ATUALIZOU, '1'); } catch { /* segue */ }
      location.reload();
    });
    document.body.appendChild(faixa);
  }

  /**
   * Primeira abertura depois de uma atualização: mostra o que mudou. Compara a versão que
   * está no aparelho com a última que a pessoa já viu; na primeira instalação só anota.
   */
  async function avisarSeAtualizou() {
    try { sessionStorage.removeItem(CHAVE_ATUALIZOU); } catch { /* nada */ }
    // sem service worker (painel de teste, WebView antiga) a versão vem do próprio sw.js
    const site = (await versaoDoSite()) || (await versaoDoArquivo());
    const atual = site || `app-${VERSAO_APP}`;
    let vista = '';
    try { vista = localStorage.getItem(CHAVE_VISTA) || ''; } catch { vista = ''; }
    try { localStorage.setItem(CHAVE_VISTA, atual); } catch { /* aparece de novo depois */ }
    if (!vista || vista === atual) return;
    const lista = NOVIDADES[site] || [];
    const titulo = `App atualizado${site ? ` (${site}${NATIVO() ? `, versão ${VERSAO_APP}` : ''})` : ` (versão ${VERSAO_APP})`}`;
    if (!lista.length || !window.UI?.sheet) { window.UI?.toast?.(`${titulo}.`); return; }
    // não abre por cima de outra folha nem no meio de uma digitação: aí fica só o aviso curto
    if (window.UI?.haFolhaAberta?.() || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) {
      window.UI.toast(`${titulo}.`);
      return;
    }
    await window.UI.sheet({
      title: titulo,
      text: `O que mudou: ${lista.map((l) => `• ${l}`).join('  ')}`,
      fields: [],
      submit: 'Entendi',
    });
  }

  /*
   * APK: o Android não deixa um app se reinstalar sozinho; o máximo é avisar e abrir o
   * download, e a pessoa toca em "Instalar" (os RDOs ficam: instala por cima). Pedido de
   * 10/11/2026: o aviso aparece sozinho ao abrir o app e ao voltar para ele, não só em
   * Minha Conta. "Depois" adia aquela versão até o dia seguinte.
   */
  const CHAVE_APK_ADIADO = 'gps_rdo_apk_adiado_v1';
  let perguntandoApk = false;
  async function oferecerApkNovo() {
    if (!NATIVO() || perguntandoApk) return;
    const nova = await versaoNovaDoApk();
    if (!nova) return;
    const hoje = new Date().toISOString().slice(0, 10);
    let adiado = '';
    try { adiado = localStorage.getItem(CHAVE_APK_ADIADO) || ''; } catch { adiado = ''; }
    if (adiado === `${nova.versao}|${hoje}`) return;
    // não interrompe quem está digitando ou com uma folha aberta: tenta de novo depois
    if (window.UI?.haFolhaAberta?.() || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
    perguntandoApk = true;
    try {
      const sim = await window.UI.sheet({
        title: `Atualização do app: versão ${nova.versao}`,
        text: `Este aparelho está com a versão ${VERSAO_APP}. Toque em "Baixar e instalar": o arquivo GPS-RDO.apk é baixado e o Android pede para instalar por cima. Os RDOs deste aparelho ficam.`,
        fields: [],
        submit: 'Baixar e instalar',
      });
      if (sim) window.open(nova.url, '_system');
      else { try { localStorage.setItem(CHAVE_APK_ADIADO, `${nova.versao}|${hoje}`); } catch { /* pergunta de novo */ } }
    } finally {
      perguntandoApk = false;
    }
  }

  /** Chamado uma vez pelo app.js depois da primeira tela: avisos de atualização. */
  function iniciarAvisos() {
    avisarSeAtualizou().catch(() => {});
    if (!NATIVO()) return;
    setTimeout(() => { oferecerApkNovo().catch(() => {}); }, 2500);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') oferecerApkNovo().catch(() => {});
    });
  }

  /**
   * No APK não há atualização silenciosa: o Android só instala outro APK com confirmação.
   * Aqui só se descobre se a release publicada é mais nova que este build, para avisar.
   */
  async function versaoNovaDoApk() {
    if (!NATIVO() || !navigator.onLine) return null;
    try {
      const r = await fetch('https://api.github.com/repos/deividmarcio0610-tech/gps-rdo/releases/latest', { cache: 'no-store' });
      if (!r.ok) return null;
      const tag = String((await r.json()).tag_name || '').replace(/^v/i, '');
      if (!tag) return null;
      const numero = (v) => String(v).split('.').map((n) => Number(n) || 0);
      const [a, b] = [numero(tag), numero(VERSAO_APP)];
      for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0) ? { versao: tag, url: APK_URL } : null;
      }
      return null;
    } catch { return null; }
  }

  /**
   * Qual publicação do site está guardada neste aparelho ("v30"). O número do app (1.7) só
   * muda junto com o APK; este muda a cada publicação, e é ele que mostra se a atualização chegou.
   */
  async function versaoDoSite() {
    try {
      const numeros = (await caches.keys())
        .map((nome) => /^gps-rdo-v(\d+)$/.exec(nome))
        .filter(Boolean)
        .map((m) => Number(m[1]));
      return numeros.length ? `v${Math.max(...numeros)}` : '';
    } catch { return ''; }
  }

  return {
    registrar, escutarConvite, podeInstalar, instalar, aoMudar, instalado, ehIOS, ehAndroid,
    checarAtualizacao, atualizarAgora, versao: () => VERSAO_APP, apkUrl: APK_URL, versaoNovaDoApk, versaoDoSite, iniciarAvisos, oferecerApkNovo,
    NOVIDADES,
  };
})();
