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
  const VERSAO_APP = '1.7';
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
      if (emUso()) { setTimeout(recarregarQuandoDer, 3000); return; }
      recarregou = true;
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
    checarAtualizacao, versao: () => VERSAO_APP, apkUrl: APK_URL, versaoNovaDoApk, versaoDoSite,
  };
})();
