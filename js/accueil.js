// Premier lancement : création de la boutique (nom, devise principale, taux du jour).
// À l'étape 2, cet écran deviendra « Se connecter / Créer un compte ».

import * as api from './api.js';
import { h, icone, champ, saisie, saisieLongue, segment, erreur, enCours, vibrer } from './ui.js';
import { lireEntier } from './money.js';
import { CONFIG } from '../config.js';
import { ecrire } from './ecriture.js';

export function afficher(racine) {
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

  const formulaire = h('form', { class: 'pile', novalidate: true },
    champ('Nom de la boutique', nom),
    h('div', { class: 'champ' },
      h('span', { class: 'champ-libelle' }, 'Devise principale'),
      segment([{ id: 'USD', libelle: 'Dollar ($)' }, { id: 'CDF', libelle: 'Franc (FC)' }], devise, (d) => { devise = d; }, { libelle: 'Devise principale' }),
      h('span', { class: 'champ-aide' }, 'Les totaux et rapports seront affichés dans cette devise. Tu peux vendre dans les deux.')),
    champ('Taux du jour : 1 $ = … FC', taux, 'Tu pourras le changer à tout moment depuis l’écran Vendre.'),
    commencer,
    exemples);

  formulaire.addEventListener('submit', (e) => {
    e.preventDefault();
    enCours(commencer, async () => {
      try { await api.creerBoutique(lire()); vibrer(); location.hash = '#/vendre'; } catch (err) { erreur(err); }
    })();
  });
  exemples.addEventListener('click', enCours(exemples, async () => {
    try {
      if (!nom.value.trim()) nom.value = 'Maison Élégance';
      const entree = lire();
      await api.creerBoutique(entree);
      await api.chargerExemples();
      vibrer();
      location.hash = '#/vendre';
    } catch (err) { erreur(err); }
  }));
  [nom, taux].forEach((x) => x.addEventListener('input', () => x.classList.remove('invalide')));

  // Nom de l'application puis phrase d'accueil, écrits progressivement.
  const titre = h('h1', { class: 'accueil-nom' });
  const sousTitre = h('p', { class: 'texte-2' });
  ecrire(titre, CONFIG.nomApp, { delai: 250, vitesse: 90 })
    .then(() => ecrire(sousTitre, 'Ventes, stock, dettes et caisse de ta boutique. Simple et fiable.', { vitesse: 28 }));

  racine.append(h('div', { class: 'accueil' },
    h('div', { class: 'accueil-marque' },
      h('div', { class: 'accueil-icone' }, icone('articles', 52)),
      titre,
      sousTitre),
    formulaire));
}
