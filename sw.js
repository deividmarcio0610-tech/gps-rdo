/*
 * Service worker: guarda o app inteiro no aparelho para funcionar sem sinal.
 * Estratégia — rede primeiro para o HTML (pega versão nova quando há internet),
 * cache primeiro para os demais arquivos, que só mudam junto com uma versão.
 */
const VERSAO = 'gps-rdo-v21';
const ESSENCIAIS = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/firebase-config.js',
  'js/nuvem.js',
  'js/vendor/firebase-app-compat.js',
  'js/vendor/firebase-auth-compat.js',
  'js/vendor/firebase-firestore-compat.js',
  'js/mestre.js',
  'js/store.js',
  'js/fotos.js',
  'js/ui.js',
  'js/conta.js',
  'js/logo.js',
  'js/pdf.js',
  'js/whatsapp.js',
  'js/screens.js',
  'js/pwa.js',
  'js/app.js',
  'jspdf.umd.min.js',
  'jspdf.plugin.autotable.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO)
      // addAll falha inteiro se um arquivo faltar; melhor falhar cedo e claro
      .then((cache) => cache.addAll(ESSENCIAIS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const { request } = evento;

  // só GET do próprio app
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // navegação: rede primeiro, cache quando offline
  if (request.mode === 'navigate') {
    evento.respondWith(
      fetch(request)
        .then((resposta) => {
          // só guarda como index.html o que for a página do app (um download, por exemplo, não)
          if (resposta.ok && (resposta.headers.get('content-type') || '').includes('text/html')) {
            const copia = resposta.clone();
            caches.open(VERSAO).then((cache) => cache.put('index.html', copia));
          }
          return resposta;
        })
        .catch(() => caches.match('index.html').then((r) => r || caches.match('./'))),
    );
    return;
  }

  // demais arquivos: cache primeiro, rede como reserva
  evento.respondWith(
    caches.match(request).then((emCache) => {
      if (emCache) return emCache;
      return fetch(request).then((resposta) => {
        if (resposta.ok) {
          const copia = resposta.clone();
          caches.open(VERSAO).then((cache) => cache.put(request, copia));
        }
        return resposta;
      }).catch(() => emCache);
    }),
  );
});

// permite que a página peça a troca imediata de versão
self.addEventListener('message', (evento) => {
  if (evento.data === 'ativar-agora') self.skipWaiting();
});
