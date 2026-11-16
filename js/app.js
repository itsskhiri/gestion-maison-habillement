// Démarrage de l'application et navigation entre les écrans (adresse « #/ecran/parametre »).

import * as api from './api.js';
import { h, vider, squelette, erreurEcran, toast } from './ui.js';
import { CONFIG } from '../config.js';
import * as accueil from './accueil.js';
import * as vendre from './vendre.js';
import * as articles from './articles.js';
import * as dettes from './dettes.js';
import * as depenses from './depenses.js';
import * as caisse from './caisse.js';
import * as rapports from './rapports.js';
import * as profil from './profil.js';
import { verifierInstallation } from './installation.js';

const racine = document.getElementById('app');
const nav = document.querySelector('.nav');

// Chaque route : motif d'adresse -> écran et onglet actif de la barre du bas.
const ROUTES = [
  [/^\/?(vendre)?$/, vendre.afficher, 'vendre'],
  [/^\/ventes$/, vendre.afficherHistorique, 'vendre'],
  [/^\/articles$/, articles.afficher, 'articles'],
  [/^\/dettes$/, dettes.afficher, 'dettes'],
  [/^\/dettes\/([\w-]+)$/, dettes.afficherFiche, 'dettes'],
  [/^\/depenses$/, depenses.afficher, 'depenses'],
  [/^\/caisse$/, caisse.afficher, 'caisse'],
  [/^\/rapports$/, rapports.afficherListe, 'caisse'],
  [/^\/rapports\/(\d{4}-\d{2}-\d{2})$/, rapports.afficherJour, 'caisse'],
  [/^\/profil$/, profil.afficher, null],
];

let jeton = 0;
let routePrecedente = null;

async function afficher() {
  const monJeton = ++jeton;
  const chemin = decodeURIComponent(location.hash.replace(/^#/, '')) || '/vendre';
  const boutique = await api.profil();

  if (!boutique) {
    document.body.classList.add('sans-nav');
    vider(racine);
    accueil.afficher(racine);
    return;
  }

  let ecran = vendre.afficher;
  let onglet = 'vendre';
  let params = [];
  for (const [motif, fn, ong] of ROUTES) {
    const r = chemin.match(motif);
    if (r) { ecran = fn; onglet = ong; params = r.slice(1); break; }
  }

  document.body.classList.remove('sans-nav', 'avec-panier');
  nav.querySelectorAll('a').forEach((a) => {
    if (a.dataset.onglet === onglet) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  // Même écran redessiné après une opération : on garde la position de défilement.
  const memeRoute = routePrecedente === chemin;
  const defilement = memeRoute ? window.scrollY : 0;
  routePrecedente = chemin;

  const conteneur = h('div', { class: 'ecran' });
  const attente = setTimeout(() => { if (monJeton === jeton) racine.replaceChildren(squelette()); }, 150);
  try {
    await ecran(conteneur, ...params);
    clearTimeout(attente);
    if (monJeton !== jeton) return; // une autre navigation a eu lieu entre-temps
    racine.replaceChildren(conteneur);
    window.scrollTo(0, defilement);
    if (!memeRoute) racine.focus({ preventScroll: true });
  } catch (e) {
    clearTimeout(attente);
    console.error(e);
    if (monJeton !== jeton) return;
    racine.replaceChildren(erreurEcran(e.message || 'Impossible d’afficher cet écran.', afficher));
  }
}

async function demarrer() {
  try {
    const { memoireSeulement } = await api.initialiser();
    if (memoireSeulement) toast('Attention : ce navigateur ne garde pas les données. Ouvre l’app dans Safari.', { duree: 8000, type: 'toast-erreur' });

    // Adresse de démonstration « ?exemples » : crée une boutique d'exemple si aucune n'existe.
    if (new URLSearchParams(location.search).has('exemples') && !(await api.profil())) {
      await api.creerBoutique({ nom_boutique: 'Maison Élégance', devise_principale: 'USD', taux: CONFIG.tauxParDefaut, fuseau: CONFIG.fuseauParDefaut });
      await api.chargerExemples();
    }
  } catch (e) {
    console.error(e);
    racine.replaceChildren(erreurEcran('Les données de cet appareil ne peuvent pas être ouvertes.', () => location.reload()));
    return;
  }
  window.addEventListener('hashchange', afficher);
  api.surChangement(afficher);
  await afficher();
  verifierInstallation();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* l'app marche aussi sans */ });
  }
}

demarrer();
