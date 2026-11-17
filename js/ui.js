// Outils d'interface partagés : création d'éléments (sans faille XSS), icônes, feuilles,
// messages, confirmations, contrôles de saisie et formats d'affichage.

import { ICONES } from './icons.js';
import { titreAnime } from './ecriture.js';
import { formater, formaterMulti, lireMontant, versSaisie, DEVISES } from './money.js';
import { categorie as infoCategorie, MODES } from './reference.js';

const NS = 'http://www.w3.org/2000/svg';

// Crée un élément. Le texte est toujours inséré comme texte (jamais comme HTML) : pas de XSS.
export function h(tag, props, ...enfants) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  ajouterEnfants(el, enfants);
  return el;
}

export function ajouterEnfants(el, enfants) {
  for (const c of enfants.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function icone(nom, taille = 22, classe = '') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', taille);
  svg.setAttribute('height', taille);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (classe) svg.setAttribute('class', classe);
  svg.innerHTML = ICONES[nom] || '';
  return svg;
}

export const vider = (el) => { el.replaceChildren(); return el; };

/* ---------- Formats ---------- */

export const fm = (unites, devise, opts) => formater(unites, devise, opts);
export const fmMulti = (parDevise, principale) => formaterMulti(parDevise, principale);
export const num = (texte, classe = '') => h('span', { class: `num ${classe}` }, texte);

// Total d'une vente : « 40 $ + 57 000 FC » pour une vente $ + FC, sinon le total dans sa devise.
export function fmVente(v) {
  if (v.totaux && v.totaux.USD > 0 && v.totaux.CDF > 0) return `${formater(v.totaux.USD, 'USD')} + ${formater(v.totaux.CDF, 'CDF')}`;
  return formater(v.total, v.devise);
}

// Montants de plusieurs devises empilés (devise principale en premier, en plus grand).
export function montantsEmpiles(parDevise, principale, classes = ['chiffre-xl', 'chiffre-l'], classeEnPlus = '') {
  const devises = ['USD', 'CDF'].filter((d) => parDevise[d]);
  if (!devises.length) devises.push(principale);
  devises.sort((a, b) => (a === principale ? -1 : b === principale ? 1 : 0));
  return h('div', { class: 'montants-empiles' },
    ...devises.map((d, i) => h('p', { class: `${classes[Math.min(i, classes.length - 1)]} ${classeEnPlus}` }, fm(parDevise[d] || 0, d))));
}

/* ---------- Identité ---------- */

export function logo(nom, taille = 40) {
  const lettre = (nom || '?').trim().charAt(0).toUpperCase() || '?';
  return h('span', { class: 'logo', style: `width:${taille}px;height:${taille}px;font-size:${Math.round(taille * 0.45)}px`, 'aria-hidden': 'true' }, lettre);
}

export function pastille(categorieId, nom, taille = 36) {
  const c = infoCategorie(categorieId);
  const el = h('span', {
    class: 'pastille' + (c ? '' : ' pastille-vide'),
    style: `width:${taille}px;height:${taille}px;${c ? `--c:${c.couleur}` : ''}`,
    'aria-hidden': 'true',
  });
  el.textContent = (nom || c?.nom || '?').trim().charAt(0).toUpperCase();
  return el;
}

/* ---------- Mise en page ---------- */

// En-tête d'écran : titre, bouton retour facultatif et accès au profil.
export function enTete({ titre, sousTitre, retour, actions = [] }) {
  return h('header', { class: 'entete' },
    retour ? h('button', { class: 'btn-icone', 'aria-label': 'Retour', onclick: () => (typeof retour === 'function' ? retour() : (location.hash = retour)) }, icone('gauche', 24)) : null,
    h('div', { class: 'entete-titres' },
      titreAnime(h('h1', { class: 'titre' }), titre),
      sousTitre ? h('p', { class: 'legende' }, sousTitre) : null),
    h('div', { class: 'entete-actions' }, ...actions, boutonTheme(), boutonProfil()));
}

// Bouton soleil / lune : passe du mode sombre au mode clair (et inversement) d'un toucher.
export function boutonTheme() {
  const sombre = () => document.documentElement.dataset.mode === 'sombre';
  const libelle = () => (sombre() ? 'Passer en mode clair' : 'Passer en mode sombre');
  const b = h('button', { class: 'btn-icone', type: 'button', 'aria-label': libelle(), title: libelle() });
  const dessiner = () => {
    b.replaceChildren(icone(sombre() ? 'soleil' : 'lune', 24));
    b.setAttribute('aria-label', libelle());
    b.title = libelle();
  };
  b.addEventListener('click', () => {
    window.cintreApparence?.choisir(sombre() ? 'clair' : 'sombre');
    dessiner();
    vibrer(8);
  });
  dessiner();
  return b;
}

export function boutonProfil() {
  return h('a', { class: 'btn-icone', href: '#/profil', 'aria-label': 'Profil de la boutique' }, icone('profil', 24));
}

export function carte(...enfants) { return h('section', { class: 'carte' }, ...enfants); }

export function etatVide({ icone: nomIcone = 'boite', titre, texte, action }) {
  return h('div', { class: 'vide' },
    h('div', { class: 'vide-illustration' }, icone(nomIcone, 34)),
    h('h2', { class: 'sous-titre' }, titre),
    texte ? h('p', { class: 'texte-2' }, texte) : null,
    action ? h('button', { class: 'btn btn-principal', onclick: action.onclick }, action.icone ? icone(action.icone, 20) : null, action.libelle) : null);
}

export function squelette(lignes = 4) {
  return h('div', { class: 'squelette-conteneur', 'aria-busy': 'true', 'aria-label': 'Chargement' },
    h('div', { class: 'squelette squelette-titre' }),
    ...Array.from({ length: lignes }, () => h('div', { class: 'squelette squelette-ligne' })));
}

export function erreurEcran(message, reessayer) {
  return h('div', { class: 'vide' },
    h('div', { class: 'vide-illustration vide-erreur' }, icone('alerte', 34)),
    h('h2', { class: 'sous-titre' }, 'Un problème est survenu'),
    h('p', { class: 'texte-2' }, message),
    h('button', { class: 'btn btn-principal', onclick: reessayer }, 'Réessayer'));
}

/* ---------- Contrôles ---------- */

// Contrôle segmenté (2 à 4 choix).
export function segment(options, valeur, onChange, { libelle } = {}) {
  const el = h('div', { class: 'segment', role: 'radiogroup', 'aria-label': libelle || null });
  const boutons = options.map((o) => h('button', {
    type: 'button', role: 'radio', class: 'segment-choix',
    'aria-checked': String(o.id === valeur),
    onclick: () => {
      boutons.forEach((b) => b.setAttribute('aria-checked', String(b === boutons[options.indexOf(o)])));
      onChange(o.id);
    },
  }, o.libelle));
  ajouterEnfants(el, boutons);
  return el;
}

// Rangée de puces (choix unique, facultatif si `facultatif`).
export function puces(options, valeur, onChange, { facultatif = false, defilante = false, grandes = false, libelle } = {}) {
  let actuel = valeur;
  const el = h('div', { class: `puces${defilante ? ' puces-defilantes' : ''}${grandes ? ' puces-grandes' : ''}`, role: 'radiogroup', 'aria-label': libelle || null });
  const boutons = options.map((o) => {
    const b = h('button', {
      type: 'button', role: 'radio', class: 'puce', 'aria-checked': String(o.id === actuel),
      onclick: () => {
        actuel = facultatif && actuel === o.id ? null : o.id;
        boutons.forEach((x, i) => x.setAttribute('aria-checked', String(options[i].id === actuel)));
        onChange(actuel);
      },
    }, o.couleur ? h('span', { class: 'puce-point', style: `--c:${o.couleur}` }) : null, o.libelle);
    return b;
  });
  ajouterEnfants(el, boutons);
  return el;
}

export const optionsDevises = () => Object.values(DEVISES).map((d) => ({ id: d.code, libelle: d.symbole }));
export const optionsModes = () => MODES.map((m) => ({ id: m.id, libelle: m.nom }));

export function champ(libelle, controle, aide) {
  return h('label', { class: 'champ' },
    h('span', { class: 'champ-libelle' }, libelle),
    controle,
    aide ? h('span', { class: 'champ-aide' }, aide) : null);
}

export function saisie(props = {}) {
  return h('input', { class: 'saisie', autocomplete: 'off', autocapitalize: 'sentences', ...props });
}

// Champ de texte qui s'agrandit sur plusieurs lignes : un nom long reste entièrement visible.
// La touche Entrée ne crée pas de nouvelle ligne (elle valide le formulaire s'il y en a un).
export function saisieLongue(props = {}) {
  const el = h('textarea', { class: 'saisie saisie-longue', rows: 1, autocomplete: 'off', autocapitalize: 'sentences', ...props });
  const ajuster = () => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; };
  el.addEventListener('input', () => {
    if (/[\r\n]/.test(el.value)) el.value = el.value.replace(/[\r\n]+/g, ' ');
    ajuster();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    el.form?.requestSubmit();
  });
  // Ajuste dès que le champ est affiché (sa largeur est alors connue).
  new ResizeObserver(ajuster).observe(el);
  return el;
}

// Champ montant avec choix de la devise ($ / FC). Renvoie { el, entree, lire(), devise(), definir() }.
export function champMontant({ devise, valeur = null, libelle = 'Montant', aide, avecDevise = true, onSaisie, onDevise }) {
  let dev = devise;
  const entree = saisie({
    inputmode: dev === 'USD' ? 'decimal' : 'numeric', placeholder: '0',
    value: valeur != null ? versSaisie(valeur, dev) : '', 'aria-label': libelle,
    oninput: () => { entree.classList.remove('invalide'); onSaisie?.(); },
  });
  const suffixe = h('span', { class: 'saisie-suffixe' }, DEVISES[dev].symbole);
  const choixDevise = avecDevise ? segment(optionsDevises(), dev, (d) => {
    const avant = lireMontant(entree.value, dev);
    dev = d;
    suffixe.textContent = DEVISES[d].symbole;
    entree.inputMode = d === 'USD' ? 'decimal' : 'numeric';
    if (avant == null) entree.value = '';
    onDevise?.(d);
    onSaisie?.();
  }, { libelle: 'Devise' }) : null;
  const el = h('div', { class: 'champ' },
    h('span', { class: 'champ-libelle' }, libelle),
    h('div', { class: 'montant-ligne' },
      h('div', { class: 'saisie-montant' }, entree, suffixe),
      choixDevise),
    aide ? h('span', { class: 'champ-aide' }, aide) : null);
  return {
    el, entree,
    lire: () => lireMontant(entree.value, dev),
    devise: () => dev,
    definir: (unites) => { entree.value = unites == null ? '' : versSaisie(unites, dev); },
    signalerErreur: () => { entree.classList.add('invalide'); entree.focus(); },
  };
}

/* ---------- Feuilles (fenêtres qui montent du bas) ---------- */

let feuillesOuvertes = 0;

export function ouvrirFeuille({ titre, contenu, onFermer, large = false }) {
  const fond = h('div', { class: 'feuille-fond' });
  const corps = h('div', { class: 'feuille-corps' });
  const titreEl = h('h2', { class: 'sous-titre feuille-titre' }, titre);
  const panneau = h('div', { class: `feuille${large ? ' feuille-large' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': titre },
    h('div', { class: 'feuille-poignee', 'aria-hidden': 'true' }),
    h('div', { class: 'feuille-entete' },
      titreEl,
      h('button', { class: 'btn-icone', 'aria-label': 'Fermer', onclick: () => fermer() }, icone('fermer', 22))),
    corps);
  let ferme = false;
  const precedent = document.activeElement;
  function fermer() {
    if (ferme) return;
    ferme = true;
    panneau.inert = true; // plus aucun toucher ni lecture d'écran pendant l'animation de fermeture
    panneau.setAttribute('aria-hidden', 'true');
    fond.classList.remove('ouvert');
    panneau.classList.remove('ouvert');
    feuillesOuvertes--;
    if (!feuillesOuvertes) document.documentElement.classList.remove('verrou');
    document.removeEventListener('keydown', clavier);
    setTimeout(() => { fond.remove(); panneau.remove(); }, 220);
    precedent?.focus?.({ preventScroll: true });
    onFermer?.();
  }
  const clavier = (e) => { if (e.key === 'Escape') fermer(); };
  fond.addEventListener('click', fermer);
  document.addEventListener('keydown', clavier);
  const remplir = (c) => ajouterEnfants(vider(corps), [typeof c === 'function' ? c() : c]);
  remplir(contenu);
  document.body.append(fond, panneau);
  feuillesOuvertes++;
  document.documentElement.classList.add('verrou');
  requestAnimationFrame(() => { fond.classList.add('ouvert'); panneau.classList.add('ouvert'); });
  return {
    fermer, corps, panneau,
    remplacer: remplir,
    titre: (t) => { titreEl.textContent = t; panneau.setAttribute('aria-label', t); },
  };
}

export function confirmer({ titre, message, ok = 'Confirmer', danger = false, annuler = 'Retour' }) {
  return new Promise((resoudre) => {
    let reponse = false;
    const f = ouvrirFeuille({
      titre,
      onFermer: () => resoudre(reponse),
      contenu: h('div', { class: 'pile' },
        message ? h('p', { class: 'texte-2' }, message) : null,
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-principal'}`, onclick: () => { reponse = true; f.fermer(); } }, ok),
        h('button', { class: 'btn btn-secondaire', onclick: () => f.fermer() }, annuler)),
    });
  });
}

/* ---------- Messages ---------- */

let zoneToasts = null;
let toastActuel = null;
export function toast(message, { action, onAction, duree = 3200, type = '' } = {}) {
  if (!zoneToasts) { zoneToasts = h('div', { class: 'zone-toasts', 'aria-live': 'polite' }); document.body.append(zoneToasts); }
  toastActuel?.fermer(); // un seul message à la fois
  toastActuel = { fermer: () => fermer() };
  const el = h('div', { class: `toast ${type}` },
    h('span', { class: 'toast-texte' }, message),
    action ? h('button', { class: 'toast-action', onclick: () => { fermer(); onAction?.(); } }, action) : null);
  zoneToasts.append(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  const minuteur = setTimeout(fermer, duree);
  function fermer() {
    clearTimeout(minuteur);
    el.classList.remove('visible');
    setTimeout(() => el.remove(), 220);
  }
  return { fermer };
}

export function erreur(e) {
  const message = e?.name === 'ErreurMetier' ? e.message : (e?.message || 'Une erreur est survenue. Réessaie.');
  toast(message, { type: 'toast-erreur', duree: 4500 });
  vibrer([20, 40, 20]);
}

export function vibrer(motif = 12) {
  try { navigator.vibrate?.(motif); } catch { /* non disponible (iPhone) */ }
}

/* ---------- Partage (WhatsApp, SMS…) ---------- */

export async function partager(texte) {
  if (navigator.share) {
    try { await navigator.share({ text: texte }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(texte);
    toast('Texte copié. Colle-le dans WhatsApp.');
  } catch {
    window.open('https://wa.me/?text=' + encodeURIComponent(texte), '_blank', 'noopener');
  }
}

export function telechargerFichier(nom, contenu, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = h('a', { href: url, download: nom });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Empêche un double toucher d'envoyer deux fois la même opération.
export function enCours(bouton, action) {
  return async (...args) => {
    if (bouton.disabled) return;
    bouton.disabled = true;
    try { return await action(...args); } finally { bouton.disabled = false; }
  };
}
