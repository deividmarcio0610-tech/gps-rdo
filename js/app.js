/* Navegação, estado do RDO aberto e ligação das telas. */
(() => {
  'use strict';

  const el = {
    app: document.getElementById('app'),
    tela: document.getElementById('screen'),
    titulo: document.getElementById('screen-title'),
    voltar: document.getElementById('btn-back'),
    relatorioTopo: document.getElementById('btn-report-top'),
    tema: document.getElementById('theme-slot'),
    instalar: document.getElementById('install-slot'),
  };

  const estado = {
    rdoId: null,
    pilha: [],  // telas empilhadas; vazio = início
  };

  // telas que funcionam sem um RDO aberto (a de apagar não pode recriar o que acabou de sumir)
  const SEM_RDO = new Set(['home', 'reports', 'backup', 'month', 'roster', 'conta']);

  // APK sempre da última versão publicada no GitHub (fora do service worker do site)
  const APK_URL = 'https://github.com/deividmarcio0610-tech/gps-rdo/releases/latest/download/GPS-RDO.apk';

  /** RDO aberto. Entrar numa seção cria o RDO em silêncio, como no original,
   *  mas reaproveita um rascunho vazio do mesmo dia para não poluir o histórico. */
  function rdoAtual(criarSeFaltar = true) {
    if (estado.rdoId) {
      const achado = Store.find(estado.rdoId);
      if (achado) return achado;
    }
    const vazioDoDia = Store.rdos.find(
      (r) => r.date === Store.todayIso() && r.status === 'draft'
        && !r.workforce.length && !r.equipmentList.length && !r.tasks.length
        && !r.occurrences.length && !r.photos.length,
    );
    if (vazioDoDia) { estado.rdoId = vazioDoDia.id; return vazioDoDia; }
    if (!criarSeFaltar) return null;
    const novo = Store.createRdo();
    estado.rdoId = novo.id;
    return novo;
  }

  /*
   * Cada tela aberta vira uma entrada no histórico do navegador, com a pilha
   * junto. Assim o voltar do Safari, o do Chrome e o botão do Android caem
   * todos no popstate, que só redesenha a pilha guardada naquela entrada.
   */
  const marcar = (substituir) => {
    const registro = { pilha: [...estado.pilha] };
    if (substituir) history.replaceState(registro, '');
    else history.pushState(registro, '');
  };

  const app = {
    go(tela, { replace = false } = {}) {
      // substituir só a tela de cima; no início não há o que substituir e a tela entra por cima
      if (replace && estado.pilha.length) {
        estado.pilha[estado.pilha.length - 1] = tela;
        marcar(true);
      } else if (estado.pilha[estado.pilha.length - 1] !== tela) {
        estado.pilha.push(tela);
        marcar(false);
      }
      if (!SEM_RDO.has(tela)) rdoAtual(true);
      render();
    },

    abrir(id) {
      estado.rdoId = id;
      estado.pilha = [];
      marcar(true);
      render();
    },

    voltar() {
      if (!estado.pilha.length) return;
      // a entrada atual veio de go(): voltar no histórico dispara o popstate, que redesenha
      if (history.state?.pilha?.length) { history.back(); return; }
      estado.pilha.pop();
      marcar(true);
      render();
    },

    render() { render(); },

    /** Volta ao início (depois de entrar, criar conta ou sair). */
    irParaInicio() {
      estado.pilha = [];
      marcar(true);
      window.scrollTo({ top: 0 });
      render();
    },
  };

  window.addEventListener('popstate', (evento) => {
    // com uma folha aberta, o voltar só fecha a folha e a tela fica onde estava
    if (UI.fecharFolhas()) { marcar(false); return; }
    const pilha = evento.state?.pilha;
    estado.pilha = Array.isArray(pilha) ? [...pilha] : [];
    render();
  });

  /**
   * Botão/gesto de voltar do Android (chamado pelo MainActivity do APK).
   * Devolve true quando o app tratou; false deixa o Android fechar o app.
   */
  window.__voltarNativo = () => {
    if (UI.fecharFolhas()) return true;
    if (!estado.pilha.length) return false;
    app.voltar();
    return true;
  };

  /*
   * iPhone com o app na Tela de Início: não há barra do Safari nem gesto de
   * voltar. Arrastar da borda esquerda para a direita volta uma tela, como
   * num app nativo. No Safari comum o próprio navegador já faz isso.
   */
  if (Pwa.ehIOS() && Pwa.instalado() && !window.Capacitor?.isNativePlatform?.()) {
    let inicio = null;
    document.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      inicio = e.touches.length === 1 && t.clientX < 28 ? { x: t.clientX, y: t.clientY } : null;
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!inicio) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - inicio.x;
      const dy = Math.abs(t.clientY - inicio.y);
      inicio = null;
      if (dx > 70 && dy < 60) window.__voltarNativo();
    }, { passive: true });
  }

  function telaAtual() {
    return estado.pilha[estado.pilha.length - 1] || 'home';
  }

  /*
   * Portão da conta: sem login (e sem "Continuar sem conta"), o app abre na tela de conta.
   * Com a sessão guardada, tudo funciona sem internet: os RDOs sobem quando a rede volta.
   */
  function portaoDeConta() {
    if (window.Conta?.ativo?.() || window.Conta?.semConta?.()) return false;
    const definicao = Conta.tela();
    el.titulo.textContent = definicao.titulo;
    el.tela.innerHTML = definicao.html;
    el.tela.scrollTop = 0;
    el.voltar.classList.add('hidden');
    el.relatorioTopo.classList.add('hidden');
    el.instalar.innerHTML = '';
    el.tema.innerHTML = '';
    document.body.classList.toggle('dark', Boolean(Store.config.darkMode));
    definicao.bind?.(el.tela);
    return true;
  }

  function render() {
    if (portaoDeConta()) return;
    const tela = telaAtual();
    const rdo = rdoAtual(!SEM_RDO.has(tela));
    if (!rdo && !SEM_RDO.has(tela)) return;

    const definicao = Screens.get(tela)(rdo);
    el.titulo.textContent = definicao.titulo;
    el.tela.innerHTML = definicao.html;
    el.tela.scrollTop = 0;

    // topo: voltar só fora do início; RELATÓRIO só no início
    el.voltar.classList.toggle('hidden', tela === 'home');
    el.relatorioTopo.classList.toggle('hidden', tela !== 'home');

    definicao.bind?.(el.tela);
    UI.ligarDitado(el.tela);

    document.body.classList.toggle('dark', Boolean(Store.config.darkMode));
    document.body.classList.toggle('campo', Boolean(Store.config.modoCampo));
    el.tema.innerHTML = `
      <button class="iconbtn" id="btn-theme" style="color:var(--text-soft)" aria-label="Alternar tema">
        ${UI.icon(Store.config.darkMode ? 'sun' : 'moon', 18)}
      </button>
      <button class="iconbtn campo-btn${Store.config.modoCampo ? ' ativo' : ''}" id="btn-campo" aria-label="Modo campo: letra maior">
        ${UI.icon('text', 18)}<span>${Store.config.modoCampo ? 'Letra normal' : 'Letra maior'}</span>
      </button>`;
    document.getElementById('btn-theme').addEventListener('click', () => {
      Store.setDarkMode(!Store.config.darkMode);
      render();
    });
    document.getElementById('btn-campo').addEventListener('click', () => {
      Store.setModoCampo(!Store.config.modoCampo);
      UI.toast(Store.config.modoCampo ? 'Modo campo: letra e botões maiores.' : 'Letra normal.');
      render();
    });

    desenharInstalacao();
    window.scrollTo({ top: 0 });
  }

  /**
   * Faixa de instalação (aparece no link, não no app instalado):
   * Android baixa o APK; iPhone mostra como pôr na Tela de Início.
   */
  function desenharInstalacao() {
    if (!el.instalar) return;
    const noApp = window.Capacitor?.isNativePlatform?.() || Pwa.instalado();
    const apk = !noApp && Pwa.ehAndroid();
    const pwa = !noApp && Pwa.podeInstalar() && !apk;
    if (!apk && !pwa) { el.instalar.innerHTML = ''; return; }

    const rotulo = Pwa.ehIOS() ? 'Instalar no iPhone (Tela de Início)' : 'Instalar aplicativo';
    el.instalar.innerHTML = `
      ${apk ? `<a class="btn ghost block" id="btn-apk" href="${APK_URL}" rel="noopener" style="font-size:12.5px">
        ${UI.icon('download', 16)}Baixar o app Android (APK)</a>` : ''}
      ${pwa ? `<button class="btn ghost block" id="btn-instalar" style="font-size:12.5px">${UI.icon('install', 16)}${rotulo}</button>` : ''}`;

    document.getElementById('btn-apk')?.addEventListener('click', () => {
      UI.toast('Baixando... depois abra o arquivo GPS-RDO.apk e permita instalar.');
    });

    document.getElementById('btn-instalar')?.addEventListener('click', async () => {
      const resultado = await Pwa.instalar();
      if (resultado === 'recusado') { UI.toast('Instalação cancelada.'); return; }
      if (resultado === 'indisponivel') {
        UI.toast('Use o menu do navegador e escolha "Instalar aplicativo".');
        return;
      }
      if (resultado === 'instalado') { render(); return; }
      // iPhone: mostra o passo a passo, já que não existe convite automático
      await UI.sheet({
        title: 'Instalar no iPhone',
        text: 'No Safari, toque no botão Compartilhar (o quadrado com a seta para cima) e escolha "Adicionar à Tela de Início". Depois confirme em "Adicionar". O app abre em tela cheia e funciona sem internet.',
        fields: [],
        submit: 'Entendi',
      });
    });
  }

  el.voltar.addEventListener('click', () => app.voltar());
  el.relatorioTopo.addEventListener('click', () => app.go('report'));

  Screens.boot(app);

  // conta logada: os RDOs do aparelho passam a ser os dessa conta
  if (Conta.ativo()) Store.usarConta(Conta.usuario().id);

  Pwa.escutarConvite();
  Pwa.registrar();
  // quando o convite chega (Android) ou o app é instalado, redesenha a faixa
  Pwa.aoMudar(() => desenharInstalacao());

  // garante um RDO aberto na primeira carga
  const ultimo = Store.rdos[0];
  if (ultimo) estado.rdoId = ultimo.id;
  else rdoAtual(true);

  // primeira entrada do histórico = início; voltar a partir dela sai do app
  marcar(true);

  // atalhos do manifest (?abrir=photos / ?abrir=report)
  const atalho = new URLSearchParams(location.search).get('abrir');
  const telasValidas = ['header', 'workforce', 'equipment', 'tasks', 'occurrences', 'stops', 'photos', 'report', 'reports', 'backup', 'month', 'roster', 'conta'];
  if (atalho && telasValidas.includes(atalho)) {
    estado.pilha.push(atalho);
    marcar(false);
  }

  render();

  // fotos de versões antigas saem do localStorage (cota de 5 MB) para o IndexedDB
  Fotos.migrar(Store).catch(() => {});

  // exposto para depuração e testes
  window.__rdo = { app, estado, render };
})();
