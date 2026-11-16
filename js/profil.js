// PROFIL de la boutique : nom, devise principale, taux, fuseau, seuil de stock bas,
// export des données (CSV), exemples de démonstration et effacement.
// Étape 2 : ajout de « Se déconnecter » et « Supprimer mon compte » ; étape 5 : réglages des e-mails.

import * as api from './api.js';
import { h, icone, enTete, logo, champ, saisie, segment, confirmer, toast, erreur, enCours, telechargerFichier, vibrer } from './ui.js';
import { lireEntier, formater } from './money.js';
import { FUSEAUX } from './reference.js';
import { aujourdhui } from './temps.js';
import { CONFIG } from '../config.js';

const EXPORTS = [
  ['ventes', 'Ventes'], ['articles', 'Articles'], ['dettes', 'Dettes'],
  ['paiements', 'Paiements des clients'], ['depenses', 'Dépenses'], ['caisse', 'Journal de caisse'],
];

export async function afficher(racine) {
  const [p, articles] = await Promise.all([api.profil(), api.listerArticles()]);
  let devise = p.devise_principale;

  const nom = saisie({ value: p.nom_boutique, maxlength: 60, autocapitalize: 'words', 'aria-label': 'Nom de la boutique' });
  const taux = saisie({ inputmode: 'numeric', value: String(p.taux), 'aria-label': 'Taux : francs pour 1 dollar' });
  const seuil = saisie({ inputmode: 'numeric', value: String(p.seuil_stock_bas), 'aria-label': 'Seuil de stock bas' });
  const fuseau = h('select', { class: 'saisie', 'aria-label': 'Fuseau horaire' },
    ...FUSEAUX.map((f) => h('option', { value: f.id, selected: f.id === p.fuseau }, f.nom)));

  const enregistrer = h('button', { class: 'btn btn-principal btn-bloc', type: 'submit' }, 'Enregistrer');
  const form = h('form', { class: 'carte pile', novalidate: true },
    champ('Nom de la boutique', nom),
    h('div', { class: 'champ' },
      h('span', { class: 'champ-libelle' }, 'Devise principale'),
      segment([{ id: 'USD', libelle: 'Dollar ($)' }, { id: 'CDF', libelle: 'Franc (FC)' }], devise, (d) => { devise = d; }, { libelle: 'Devise principale' }),
      h('span', { class: 'champ-aide' }, 'Devise des totaux et des rapports. Elle ne peut plus changer après la première opération.')),
    champ('Taux du jour : 1 $ = … FC', taux),
    champ('Seuil de stock bas', seuil, 'Un article est signalé quand il en reste ce nombre ou moins.'),
    champ('Fuseau horaire', fuseau),
    enregistrer);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    enCours(enregistrer, async () => {
      try {
        const t = lireEntier(taux.value);
        const s = lireEntier(seuil.value);
        if (!t) { taux.classList.add('invalide'); throw new api.ErreurMetier('Saisis un taux valide (ex. 2850).'); }
        if (s == null) { seuil.classList.add('invalide'); throw new api.ErreurMetier('Saisis un seuil valide (ex. 3).'); }
        await api.modifierProfil({ nom_boutique: nom.value, devise_principale: devise, taux: t, seuil_stock_bas: s, fuseau: fuseau.value });
        vibrer();
        toast('Profil enregistré');
      } catch (err) { erreur(err); }
    })();
  });

  const exemples = h('button', { class: 'btn btn-neutre btn-bloc' }, 'Charger des exemples');
  exemples.addEventListener('click', enCours(exemples, async () => {
    try {
      await api.chargerExemples();
      toast('Exemples chargés : articles, 30 jours de ventes, dettes et dépenses.');
      location.hash = '#/caisse';
    } catch (e) { erreur(e); }
  }));

  const effacer = h('button', { class: 'btn-texte-danger btn-bloc' }, icone('corbeille', 20), ' Tout effacer sur cet appareil');
  effacer.addEventListener('click', enCours(effacer, async () => {
    const ok1 = await confirmer({
      titre: 'Tout effacer ?',
      message: 'Articles, ventes, dettes, dépenses et caisse seront supprimés de cet appareil. Pense à exporter tes données avant.',
      ok: 'Continuer', danger: true,
    });
    if (!ok1) return;
    const ok2 = await confirmer({ titre: 'Es-tu vraiment sûr ?', message: 'Cette action est définitive.', ok: 'Oui, tout effacer', danger: true });
    if (!ok2) return;
    try {
      const garder = await confirmer({ titre: 'Garder la boutique ?', message: `Garder le nom « ${p.nom_boutique} » et les réglages (utile pour effacer seulement les exemples).`, ok: 'Garder la boutique', annuler: 'Tout supprimer' });
      await api.toutEffacer({ garderBoutique: garder });
      toast('Données effacées');
      location.hash = '#/vendre';
    } catch (e) { erreur(e); }
  }));

  racine.append(
    enTete({ titre: 'Profil', retour: () => history.length > 1 ? history.back() : (location.hash = '#/vendre') }),
    h('div', { class: 'rangee', style: 'gap:16px;margin-bottom:24px' },
      logo(p.nom_boutique, 56),
      h('div', {},
        h('p', { class: 'sous-titre' }, p.nom_boutique),
        h('p', { class: 'texte-2' }, `1 $ = ${formater(p.taux, 'CDF')} · ${articles.length} article${articles.length > 1 ? 's' : ''}`))),
    form,
    h('div', { class: 'section-titre' }, h('h2', { class: 'sous-titre' }, 'Exporter mes données')),
    h('div', { class: 'liste' }, ...EXPORTS.map(([table, libelle]) => h('button', {
      class: 'liste-ligne',
      onclick: async () => {
        try {
          const contenu = await api.exporterCSV(table);
          telechargerFichier(`cintre-${table}-${aujourdhui()}.csv`, contenu);
        } catch (e) { erreur(e); }
      },
    }, h('span', { class: 'icone-ronde' }, icone('telecharger', 20)),
    h('span', { class: 'liste-ligne-corps' }, h('span', { class: 'liste-ligne-titre' }, libelle), h('span', { class: 'liste-ligne-sous' }, 'Fichier CSV (Excel)'))))),
    h('div', { class: 'section-titre' }, h('h2', { class: 'sous-titre' }, 'Démonstration')),
    h('div', { class: 'carte pile' },
      h('p', { class: 'texte-2' }, 'Charge environ 15 articles de mode, 30 jours de ventes, des dettes et des dépenses pour découvrir tous les écrans.'),
      exemples),
    h('div', { style: 'margin-top:24px' }, effacer),
    h('p', { class: 'legende', style: 'text-align:center;margin-top:24px' }, `${CONFIG.nomApp} ${CONFIG.version} · données enregistrées sur cet appareil`));
}
