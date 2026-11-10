/* Navegação, estado do RDO aberto e ligação das telas. */
(() => {
  'use strict';

  const el = {
    app: document.getElementById('app'),
    tela: document.getElementById('screen'),
    titulo: document.getElementById('screen-title'),
    voltar: document.getElementById('btn-back'),
    sairTopo: document.getElementById('btn-sair-top'),
    relatorioTopo: document.getElementById('btn-report-top'),
    tema: document.getElementById('theme-slot'),
    instalar: document.getElementById('install-slot'),
  };

  const estado = {
    rdoId: null,
    pilha: [],  // telas empilhadas; vazio = início
    // Em Gerar Relatório, só o RDO escolhido pelo toque abre. Sem isso a tela monta
    // já no relatório inteiro ao abrir a página, em vez de mostrar só a lista.
    escolhido: false,
    // o próximo desenho leva a tela até as abas do RDO recém-aberto, em vez de voltar ao topo
    rolarAoRelatorio: false,
  };

  // telas que funcionam sem um RDO aberto (a de apagar não pode recriar o que acabou de sumir)
  const SEM_RDO = new Set(['home', 'reports', 'backup', 'month', 'roster', 'conta', 'equipe', 'controle', 'sair']);

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
    // aparelho sem espaço: o RDO não foi criado; quem chamou avisa e não troca de tela
    if (!novo) return null;
    estado.rdoId = novo.id;
    return novo;
  }

  /*
   * Cada tela aberta vira uma entrada no histórico do navegador, com a pilha
   * junto. Assim o voltar do Safari, o do Chrome e o botão do Android caem
   * todos no popstate, que só redesenha a pilha guardada naquela entrada.
   */
  const marcar = (substituir) => {
    const registro = { pilha: [...estado.pilha], escolhido: estado.escolhido };
    if (substituir) history.replaceState(registro, '');
    else history.pushState(registro, '');
  };

  const app = {
    go(tela, { replace = false } = {}) {
      // a tela precisa de um RDO e não deu para criar (aparelho cheio): fica onde está
      if (!SEM_RDO.has(tela) && !rdoAtual(true)) {
        UI.toast('Não foi possível criar o RDO: o aparelho está sem espaço. Apague relatórios antigos.');
        return;
      }
      // só a escolha explícita (botão RELATÓRIO do início) abre o relatório inteiro;
      // qualquer outra entrada em Gerar Relatório mostra a lista.
      // Vem antes de marcar(): a entrada do histórico guarda a escolha desta tela. Antes ela
      // guardava a da tela anterior, e voltar de uma edição caía na lista, não no relatório.
      estado.escolhido = tela === 'report';
      // substituir só a tela de cima; no início não há o que substituir e a tela entra por cima
      if (replace && estado.pilha.length) {
        estado.pilha[estado.pilha.length - 1] = tela;
        marcar(true);
      } else if (estado.pilha[estado.pilha.length - 1] !== tela) {
        estado.pilha.push(tela);
        marcar(false);
      }
      Screens.aoEntrar?.(tela);
      render();
    },

    /** Abre o RDO escolhido na lista já na página dele (relatório), de onde se edita e gera o PDF.
     *  Entra por cima, como as demais telas: o voltar retorna à lista (ou tela) de onde se abriu. */
    abrir(id) {
      estado.rdoId = id;
      estado.escolhido = true;
      estado.rolarAoRelatorio = true;
      estado.pilha = ['report'];
      marcar(false);
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

    /**
     * Redesenha a tela só se não for atrapalhar: sem folha aberta e sem campo em uso. Serve
     * para o que chega sozinho (RDO que desceu do banco, gravação feita em outra aba): a
     * lista fica em dia, mas quem está digitando não perde o que digitou.
     */
    renderSeguro() {
      if (ocupadoDigitando()) { estado.redesenhoPendente = true; return false; }
      estado.redesenhoPendente = false;
      render();
      return true;
    },

    /** Volta ao início (depois de entrar, criar conta ou sair). */
    irParaInicio() {
      estado.pilha = [];
      estado.escolhido = false;
      // o RDO aberto é o mais recente da conta que está agora no aparelho (ou nenhum)
      estado.rdoId = Store.rdos[0]?.id || null;
      marcar(true);
      window.scrollTo({ top: 0 });
      render();
    },
  };

  /** Há folha aberta, campo com o cursor ou formulário na tela? Então não é hora de redesenhar. */
  function ocupadoDigitando() {
    if (UI.haFolhaAberta?.() || document.querySelector('.scrim')) return true;
    const foco = document.activeElement;
    if (foco && /^(INPUT|TEXTAREA|SELECT)$/.test(foco.tagName) && el.app.contains(foco)) return true;
    // formulários que só gravam no botão Salvar (cabeçalho, etapas, cadastro): redesenhar apagaria o digitado
    return Boolean(el.tela.querySelector('fieldset.campos:not([disabled]), form[data-form]'));
  }

  window.addEventListener('popstate', (evento) => {
    // com uma folha aberta, o voltar só fecha a folha e a tela fica onde estava
    if (UI.fecharFolhas()) { marcar(false); return; }
    const pilha = evento.state?.pilha;
    estado.pilha = Array.isArray(pilha) ? [...pilha] : [];
    estado.escolhido = evento.state?.escolhido === true;
    // voltou para uma lista do banco (depois de corrigir um RDO, por exemplo): ela é relida
    Screens.aoEntrar?.(telaAtual());
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
   * Portão da conta: a conta é obrigatória — sem login o app abre na tela de entrar/criar.
   * Com a sessão guardada, tudo funciona sem internet: os RDOs sobem quando a rede volta.
   */
  function portaoDeConta() {
    if (window.Conta?.ativo?.()) return false;
    const definicao = Conta.tela();
    el.titulo.textContent = definicao.titulo;
    el.tela.innerHTML = definicao.html;
    el.tela.scrollTop = 0;
    el.voltar.classList.add('hidden');
    el.voltar.classList.remove('fora');
    el.sairTopo?.classList.add('fora');
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
    // Gerar Relatório sem escolha mostra só a lista: nem escolhe nem cria RDO ao montar
    const soLista = tela === 'report' && !estado.escolhido;
    const rdo = soLista ? null : rdoAtual(!SEM_RDO.has(tela));
    if (!rdo && !SEM_RDO.has(tela) && !soLista) return;

    const definicao = Screens.get(tela)(rdo);
    el.titulo.textContent = definicao.titulo;
    el.tela.innerHTML = definicao.html;
    el.tela.scrollTop = 0;

    // topo: voltar só fora do início; no início, o lugar dele é do SAIR. RELATÓRIO só no início
    el.voltar.classList.remove('hidden');
    el.voltar.classList.toggle('fora', tela === 'home');
    el.sairTopo?.classList.toggle('fora', tela !== 'home');
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
    // RDO recém-aberto: a tela desce até as abas dele (a lista de RDOs fica acima); senão, topo
    const alvo = estado.rolarAoRelatorio && tela === 'report' ? document.getElementById('rel-topo') : null;
    estado.rolarAoRelatorio = false;
    if (alvo) alvo.scrollIntoView({ block: 'start' });
    else window.scrollTo({ top: 0 });
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
  // pedido de 10/11/2026: SAIR no topo do início leva à página de sair (que volta para o login)
  el.sairTopo?.addEventListener('click', () => app.go('sair'));

  /*
   * Outra aba gravou (Gerar Relatório e Controle abrem em aba própria): esta aba relê os
   * dados do aparelho na hora, para não gravar a cópia velha por cima depois, e atualiza a
   * tela quando isso não atrapalha.
   */
  window.addEventListener('storage', (evento) => {
    if (evento.key && !evento.key.startsWith('rdo_digital_db_v1')) return;
    if (Store.recarregarSeMudou()) app.renderSeguro();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Store.recarregarSeMudou() || estado.redesenhoPendente) app.renderSeguro();
  });

  Screens.boot(app);

  // conta logada: os RDOs do aparelho passam a ser os dessa conta
  if (Conta.ativo()) Store.usarConta(Conta.usuario().id);
  // banco na nuvem: acompanha a sessão e troca os RDOs quando houver internet
  Conta.iniciar?.();

  Pwa.escutarConvite();
  Pwa.registrar();
  // quando o convite chega (Android) ou o app é instalado, redesenha a faixa
  Pwa.aoMudar(() => desenharInstalacao());

  // O RDO aberto na primeira carga é o mais recente. Sem nenhum, não se cria um aqui: antes
  // só abrir o app (até na tela de login) já criava um RDO em branco, que subia para o banco
  // e contava no Controle de RDO como se a pessoa tivesse feito o RDO do dia. O RDO nasce
  // quando ela entra numa seção ou toca em "Novo RDO".
  const ultimo = Store.rdos[0];
  if (ultimo) estado.rdoId = ultimo.id;

  // primeira entrada do histórico = início; voltar a partir dela sai do app
  marcar(true);

  // atalhos do manifest (?abrir=photos / ?abrir=report)
  const parametros = new URLSearchParams(location.search);
  const atalho = parametros.get('abrir');
  // aba nova do "Gerar Relatório": abre o mesmo RDO que estava aberto na outra aba
  const rdoPedido = parametros.get('rdo');
  if (rdoPedido && Store.find(rdoPedido)) estado.rdoId = rdoPedido;
  const telasValidas = ['header', 'etapas', 'workforce', 'equipment', 'tasks', 'occurrences', 'stops', 'photos', 'report', 'reports', 'backup', 'month', 'roster', 'conta', 'equipe', 'controle'];
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
