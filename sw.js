/*
 * Service worker: guarda o app inteiro no aparelho para funcionar sem sinal.
 * Estratégia — rede primeiro para o HTML (pega versão nova quando há internet),
 * cache primeiro para os demais arquivos, que só mudam junto com uma versão.
 */
const VERSAO = 'gps-rdo-v32';
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
      // addAll falha inteiro se um arquivo faltar; melhor falhar cedo e claro.
      // 'reload' busca cada arquivo na rede, sem passar pela memória do navegador: com duas
      // publicações no mesmo dia, a versão nova podia guardar arquivo da anterior e ficar
      // misturada (tela nova com código velho) até a próxima publicação.
      .then((cache) => cache.addAll(ESSENCIAIS.map((arquivo) => new Request(arquivo, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      // só as versões antigas DESTE app: o endereço do site pode abrigar outros apps, com os caches deles
      .then((chaves) => Promise.all(chaves.filter((k) => k.startsWith('gps-rdo-') && k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Com sinal fraco a rede não responde nem falha: fica pendurada. Depois deste tempo o app
// abre com a cópia guardada, em vez de deixar a tela em branco até a rede desistir.
const PRAZO_DA_REDE = 3000;

self.addEventListener('fetch', (evento) => {
  const { request } = evento;

  // só GET do próprio app
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // navegação: rede primeiro (pega a versão nova quando há internet), cache quando offline,
  // quando a rede demora demais ou quando o servidor responde com erro
  if (request.mode === 'navigate') {
    const daRede = fetch(request).then((resposta) => {
      // só guarda como index.html o que for a página do app (um download, por exemplo, não)
      if (resposta.ok && (resposta.headers.get('content-type') || '').includes('text/html')) {
        const copia = resposta.clone();
        caches.open(VERSAO).then((cache) => cache.put('index.html', copia));
      }
      return resposta;
    });
    // a busca continua mesmo depois de o app abrir pelo cache: a página guardada fica em dia
    evento.waitUntil(daRede.catch(() => {}));
    evento.respondWith((async () => {
      const guardada = (await caches.match('index.html')) || (await caches.match('./'));
      // primeira abertura, ainda sem nada guardado: só a rede resolve
      if (!guardada) return daRede;
      let relogio = null;
      const prazo = new Promise((resolver) => { relogio = setTimeout(() => resolver(null), PRAZO_DA_REDE); });
      const resposta = await Promise.race([daRede.catch(() => null), prazo]);
      clearTimeout(relogio);
      return resposta && resposta.ok ? resposta : guardada;
    })());
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
