// Aide à l'installation sur l'écran d'accueil de l'iPhone, et message si l'app est
// ouverte dans un autre navigateur que Safari (WhatsApp, Facebook, Chrome…).

import { h, icone, ouvrirFeuille } from './ui.js';

const CLE_VUE = 'cintre.astuce-installation-vue';

const estIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const estInstallee = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const horsSafari = () => /CriOS|FxiOS|EdgiOS|OPiOS|FBAN|FBAV|Instagram|WhatsApp|Line\//.test(navigator.userAgent);

function lireDrapeau() { try { return localStorage.getItem(CLE_VUE) === '1'; } catch { return false; } }
function ecrireDrapeau() { try { localStorage.setItem(CLE_VUE, '1'); } catch { /* sans effet */ } }

function etape(numero, contenu) {
  return h('li', { class: 'rangee', style: 'gap:12px;align-items:center' },
    h('span', { class: 'icone-ronde accent', style: 'font-weight:700' }, String(numero)),
    h('span', {}, ...contenu));
}

export function verifierInstallation() {
  if (!estIOS() || estInstallee()) return;

  if (horsSafari()) {
    ouvrirFeuille({
      titre: 'Ouvre ce lien dans Safari',
      contenu: h('div', { class: 'pile' },
        h('p', { class: 'texte-2' }, 'Pour installer Cintre sur ton iPhone et garder tes données en sécurité, ouvre ce lien dans Safari.'),
        h('ol', { class: 'pile', style: 'list-style:none;padding:0;margin:0' },
          etape(1, ['Touche le menu ', h('strong', {}, '…'), ' ou ', h('strong', {}, 'Partager')]),
          etape(2, ['Choisis ', h('strong', {}, '« Ouvrir dans Safari »')]))),
    });
    return;
  }

  if (lireDrapeau()) return;
  ecrireDrapeau();
  ouvrirFeuille({
    titre: 'Installe Cintre sur ton iPhone',
    contenu: h('div', { class: 'pile' },
      h('p', { class: 'texte-2' }, 'Ajoute l’app sur ton écran d’accueil : elle s’ouvrira comme une vraie application, même sans internet.'),
      h('ol', { class: 'pile', style: 'list-style:none;padding:0;margin:0' },
        etape(1, ['Touche ', h('strong', {}, 'Partager'), ' ', icone('partager', 18)]),
        etape(2, ['Touche ', h('strong', {}, '« Sur l’écran d’accueil »')]),
        etape(3, ['Touche ', h('strong', {}, 'Ajouter')]))),
  });
}
