// Service worker : garde une copie de l'application pour qu'elle s'ouvre sans internet.
// Stratégie : réponse immédiate depuis le cache, puis mise à jour en arrière-plan.
// Changer VERSION à chaque mise en ligne pour remplacer l'ancienne copie.

const VERSION = 'cintre-0.6.0';
const FICHIERS = [
  './', './index.html', './manifest.json', './config.js', './css/style.css',
  './js/app.js', './js/api.js', './js/db.js', './js/moteur.js', './js/money.js', './js/temps.js',
  './js/reference.js', './js/ui.js', './js/icons.js', './js/charts.js', './js/exemples.js',
  './js/installation.js', './js/theme.js', './js/ecriture.js', './js/accueil.js', './js/vendre.js', './js/articles.js', './js/dettes.js',
  './js/depenses.js', './js/caisse.js', './js/factures.js', './js/impression.js', './js/rapports.js', './js/profil.js',
  './icons/icone.svg', './icons/icone-192.png', './icons/icone-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((cles) => Promise.all(cles.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const enCache = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    const reseau = fetch(req).then((rep) => {
      if (rep.ok) cache.put(req, rep.clone());
      return rep;
    }).catch(() => null);
    if (enCache) { e.waitUntil(reseau); return enCache; }
    const rep = await reseau;
    if (rep) return rep;
    if (req.mode === 'navigate') return cache.match('./index.html');
    return new Response('', { status: 504 });
  }));
});
