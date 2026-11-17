// Écran d'accueil.
//   - Avec un serveur (config.js) : « Se connecter » / « Créer un compte », confirmation de l'e-mail,
//     mot de passe oublié, nouveau mot de passe.
//   - Sans serveur (appareil seul) : création de la boutique sur l'appareil, comme à l'étape 1.

import * as api from './api.js';
import { h, icone, champ, saisie, saisieLongue, segment, erreur, enCours, vibrer, toast } from './ui.js';
import { lireEntier } from './money.js';
import { CONFIG } from '../config.js';
import { ecrire } from './ecriture.js';

// Vue affichée : 'choix', 'connexion', 'inscription', 'verifier', 'oubli', 'nouveau'
const etatEcran = { vue: 'choix', email: '', animationJouee: false };

export function ouvrirVue(vue) { etatEcran.vue = vue; }

export function afficher(racine) {
  const titre = h('h1', { class: 'accueil-nom' });
  const sousTitre = h('p', { class: 'texte-2' });
  const phrase = 'Ventes, stock, dettes et caisse de ta boutique. Simple et fiable.';
  if (!etatEcran.animationJouee) {
    etatEcran.animationJouee = true;
    ecrire(titre, CONFIG.nomApp, { delai: 250, vitesse: 90 }).then(() => ecrire(sousTitre, phrase, { vitesse: 28 }));
  } else {
    titre.textContent = CONFIG.nomApp;
    sousTitre.textContent = phrase;
  }
  const zone = h('div', { class: 'pile' });
  racine.append(h('div', { class: 'accueil' },
    h('div', { class: 'accueil-marque' }, h('div', { class: 'accueil-icone' }, icone('articles', 52)), titre, sousTitre),
    zone));

  const aller = (vue) => { etatEcran.vue = vue; zone.replaceChildren(vueActuelle()); };
  const vueActuelle = () => {
    if (!api.serveurActif()) return vueBoutiqueLocale();
    return ({ choix: vueChoix, connexion: vueConnexion, inscription: vueInscription, verifier: vueVerifier,
      oubli: vueOubli, nouveau: vueNouveau })[etatEcran.vue]?.(aller) ?? vueChoix(aller);
  };
  zone.append(vueActuelle());
}

/* ---------- Champs communs ---------- */

function champEmail(valeur = '') {
  return saisie({ type: 'email', inputmode: 'email', autocomplete: 'email', autocapitalize: 'off', value: valeur, placeholder: 'ton@email.com', 'aria-label': 'Adresse e-mail' });
}

// Mot de passe avec bouton « afficher / masquer ».
function champMotDePasse({ nouveau = false, libelle = 'Mot de passe' } = {}) {
  const entree = saisie({ type: 'password', autocomplete: nouveau ? 'new-password' : 'current-password', autocapitalize: 'off', 'aria-label': libelle, placeholder: nouveau ? '8 caractères minimum' : '' });
  const bouton = h('button', { type: 'button', class: 'btn-icone mdp-oeil', 'aria-label': 'Afficher le mot de passe' }, icone('oeil', 22));
  bouton.addEventListener('click', () => {
    const visible = entree.type === 'text';
    entree.type = visible ? 'password' : 'text';
    bouton.replaceChildren(icone(visible ? 'oeil' : 'oeilBarre', 22));
    bouton.setAttribute('aria-label', visible ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
  });
  return { entree, el: h('div', { class: 'mdp' }, entree, bouton) };
}

function formulaire(enfants, bouton, action) {
  const f = h('form', { class: 'pile', novalidate: true }, ...enfants, bouton);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    enCours(bouton, async () => { try { await action(); } catch (err) { erreur(err); } })();
  });
  return f;
}

const lien = (texte, onclick) => h('button', { type: 'button', class: 'btn btn-texte btn-bloc', onclick }, texte);

/* ---------- Vues ---------- */

function vueChoix(aller) {
  return h('div', { class: 'pile' },
    h('button', { class: 'btn btn-principal btn-bloc btn-grand', onclick: () => aller('connexion') }, 'Se connecter'),
    h('button', { class: 'btn btn-secondaire btn-bloc btn-grand', onclick: () => aller('inscription') }, 'Créer un compte'),
    h('p', { class: 'champ-aide', style: 'text-align:center' }, 'Tes données sont gardées en sécurité sur ton compte et restent sur ton téléphone, même sans internet.'));
}

function vueConnexion(aller) {
  const email = champEmail(etatEcran.email);
  const mdp = champMotDePasse();
  const bouton = h('button', { class: 'btn btn-principal btn-bloc btn-grand', type: 'submit' }, 'Se connecter');
  return h('div', { class: 'pile' },
    h('h2', { class: 'sous-titre' }, 'Connexion'),
    formulaire([champ('E-mail', email), h('div', { class: 'champ' }, h('span', { class: 'champ-libelle' }, 'Mot de passe'), mdp.el)], bouton, async () => {
      etatEcran.email = email.value;
      if (!email.value.trim() || !mdp.entree.value) throw new api.ErreurMetier('Saisis ton e-mail et ton mot de passe.');
      await api.connexion(email.value, mdp.entree.value);
      vibrer();
      location.hash = '#/vendre';
    }),
    lien('Mot de passe oublié ?', () => { etatEcran.email = email.value; aller('oubli'); }),
    lien('Pas encore de compte ? Créer un compte', () => aller('inscription')));
}

function vueInscription(aller) {
  let devise = 'USD';
  const nom = saisieLongue({ placeholder: 'Ex. Maison Élégance', maxlength: 60, autocapitalize: 'words', 'aria-label': 'Nom de la boutique' });
  const email = champEmail(etatEcran.email);
  const mdp = champMotDePasse({ nouveau: true });
  const taux = saisie({ inputmode: 'numeric', value: String(CONFIG.tauxParDefaut), 'aria-label': 'Taux du jour en francs pour 1 dollar' });
  const bouton = h('button', { class: 'btn btn-principal btn-bloc btn-grand', type: 'submit' }, 'Créer mon compte');
  return h('div', { class: 'pile' },
    h('h2', { class: 'sous-titre' }, 'Créer un compte'),
    formulaire([
      champ('Nom de la boutique', nom),
      champ('E-mail', email),
      h('div', { class: 'champ' }, h('span', { class: 'champ-libelle' }, 'Mot de passe'), mdp.el, h('span', { class: 'champ-aide' }, '8 caractères minimum.')),
      h('div', { class: 'champ' },
        h('span', { class: 'champ-libelle' }, 'Devise principale'),
        segment([{ id: 'USD', libelle: 'Dollar ($)' }, { id: 'CDF', libelle: 'Franc (FC)' }], devise, (d) => { devise = d; }, { libelle: 'Devise principale' })),
      champ('Taux du jour : 1 $ = … FC', taux),
    ], bouton, async () => {
      etatEcran.email = email.value;
      if (!nom.value.trim()) { nom.focus(); throw new api.ErreurMetier('Saisis le nom de ta boutique.'); }
      if (!email.value.trim()) { email.focus(); throw new api.ErreurMetier('Saisis ton e-mail.'); }
      const t = lireEntier(taux.value);
      if (!t) { taux.focus(); throw new api.ErreurMetier('Saisis un taux valide (ex. 2850).'); }
      const r = await api.creerCompte({
        email: email.value, motDePasse: mdp.entree.value,
        boutique: { nom_boutique: nom.value, devise_principale: devise, taux: t, fuseau: CONFIG.fuseauParDefaut },
      });
      vibrer();
      if (r.confirmationNecessaire) aller('verifier');
      else location.hash = '#/vendre';
    }),
    lien('Déjà un compte ? Se connecter', () => aller('connexion')));
}

function vueVerifier(aller) {
  const renvoyer = h('button', { class: 'btn btn-secondaire btn-bloc', type: 'button' }, 'Renvoyer l’e-mail');
  renvoyer.addEventListener('click', enCours(renvoyer, async () => {
    try { await api.renvoyerConfirmation(etatEcran.email); toast('E-mail renvoyé. Regarde aussi dans les indésirables.'); } catch (e) { erreur(e); }
  }));
  return h('div', { class: 'pile', style: 'text-align:center;align-items:center' },
    h('span', { class: 'cachet-ok' }, icone('coche', 30)),
    h('h2', { class: 'sous-titre' }, 'Vérifie ta boîte mail'),
    h('p', { class: 'texte-2' }, `Nous avons envoyé un lien à ${etatEcran.email}. Ouvre-le pour activer ton compte, puis connecte-toi.`),
    renvoyer,
    h('button', { class: 'btn btn-principal btn-bloc', onclick: () => aller('connexion') }, 'J’ai confirmé, me connecter'));
}

function vueOubli(aller) {
  const email = champEmail(etatEcran.email);
  const bouton = h('button', { class: 'btn btn-principal btn-bloc btn-grand', type: 'submit' }, 'Recevoir le lien');
  return h('div', { class: 'pile' },
    h('h2', { class: 'sous-titre' }, 'Mot de passe oublié'),
    h('p', { class: 'texte-2' }, 'Saisis ton e-mail : tu recevras un lien pour choisir un nouveau mot de passe.'),
    formulaire([champ('E-mail', email)], bouton, async () => {
      etatEcran.email = email.value;
      if (!email.value.trim()) throw new api.ErreurMetier('Saisis ton e-mail.');
      await api.motDePasseOublie(email.value);
      toast('Lien envoyé. Regarde ta boîte mail (et les indésirables).', { duree: 6000 });
      aller('connexion');
    }),
    lien('Retour à la connexion', () => aller('connexion')));
}

function vueNouveau() {
  const mdp = champMotDePasse({ nouveau: true, libelle: 'Nouveau mot de passe' });
  const bouton = h('button', { class: 'btn btn-principal btn-bloc btn-grand', type: 'submit' }, 'Enregistrer le mot de passe');
  return h('div', { class: 'pile' },
    h('h2', { class: 'sous-titre' }, 'Nouveau mot de passe'),
    formulaire([h('div', { class: 'champ' }, h('span', { class: 'champ-libelle' }, 'Nouveau mot de passe'), mdp.el, h('span', { class: 'champ-aide' }, '8 caractères minimum.'))], bouton, async () => {
      await api.changerMotDePasse(mdp.entree.value);
      etatEcran.vue = 'choix';
      toast('Mot de passe changé.');
      vibrer();
      location.hash = '#/vendre';
    }));
}

/* ---------- Sans serveur : boutique sur l'appareil seul ---------- */

function vueBoutiqueLocale() {
  let devise = 'USD';
  const nom = saisieLongue({ placeholder: 'Ex. Maison Élégance', maxlength: 60, autocapitalize: 'words', 'aria-label': 'Nom de la boutique' });
  const taux = saisie({ inputmode: 'numeric', value: String(CONFIG.tauxParDefaut), 'aria-label': 'Taux du jour en francs pour 1 dollar' });
  const lire = () => {
    const t = lireEntier(taux.value);
    if (!nom.value.trim()) { nom.classList.add('invalide'); nom.focus(); throw new api.ErreurMetier('Saisis le nom de ta boutique.'); }
    if (!t) { taux.classList.add('invalide'); taux.focus(); throw new api.ErreurMetier('Saisis un taux valide (ex. 2850).'); }
    return { nom_boutique: nom.value, devise_principale: devise, taux: t, fuseau: CONFIG.fuseauParDefaut };
  };
  const commencer = h('button', { class: 'btn btn-principal btn-bloc btn-grand', type: 'submit' }, 'Commencer');
  const exemples = h('button', { class: 'btn btn-texte btn-bloc', type: 'button' }, 'Essayer avec des exemples');
  exemples.addEventListener('click', enCours(exemples, async () => {
    try {
      if (!nom.value.trim()) nom.value = 'Maison Élégance';
      await api.creerBoutique(lire());
      await api.chargerExemples();
      vibrer();
      location.hash = '#/vendre';
    } catch (err) { erreur(err); }
  }));
  [nom, taux].forEach((x) => x.addEventListener('input', () => x.classList.remove('invalide')));
  return h('div', { class: 'pile' },
    formulaire([
      champ('Nom de la boutique', nom),
      h('div', { class: 'champ' },
        h('span', { class: 'champ-libelle' }, 'Devise principale'),
        segment([{ id: 'USD', libelle: 'Dollar ($)' }, { id: 'CDF', libelle: 'Franc (FC)' }], devise, (d) => { devise = d; }, { libelle: 'Devise principale' }),
        h('span', { class: 'champ-aide' }, 'Les totaux et rapports seront affichés dans cette devise. Tu peux vendre dans les deux.')),
      champ('Taux du jour : 1 $ = … FC', taux, 'Tu pourras le changer à tout moment depuis l’écran Vendre.'),
    ], commencer, async () => { await api.creerBoutique(lire()); vibrer(); location.hash = '#/vendre'; }),
    exemples);
}
