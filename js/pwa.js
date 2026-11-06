/*
 * Instalação: registra o service worker, guarda o convite de instalação do
 * Android/Chrome e mostra o passo a passo no iPhone, que não expõe evento.
 */
window.Pwa = (() => {
  'use strict';

  let convite = null;          // BeforeInstallPromptEvent (Android/Chrome)
  const ouvintes = [];

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

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        // quando houver versão nova, ativa sem recarregar na cara do usuário
        reg.addEventListener('updatefound', () => {
          const novo = reg.installing;
          novo?.addEventListener('statechange', () => {
            if (novo.state === 'installed' && navigator.serviceWorker.controller) notificar();
          });
        });
      }).catch(() => { /* sem service worker o app ainda abre, só não fica offline */ });
    });
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

  return { registrar, escutarConvite, podeInstalar, instalar, aoMudar, instalado, ehIOS, ehAndroid };
})();
