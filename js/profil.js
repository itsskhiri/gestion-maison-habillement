// PROFIL de la boutique : nom, devise principale, taux, fuseau, seuil de stock bas,
// export des données (CSV), exemples de démonstration et effacement.
// Étape 2 : ajout de « Se déconnecter » et « Supprimer mon compte » ; étape 5 : réglages des e-mails.

import * as api from './api.js';
import { h, icone, enTete, logo, champ, saisie, saisieLongue, segment, confirmer, toast, erreur, enCours, telechargerFichier, vibrer, ouvrirFeuille } from './ui.js';
import { lireEntier, formater } from './money.js';
import { FUSEAUX } from './reference.js';
import { aujourdhui } from './temps.js';
import { CONFIG } from '../config.js';

const EXPORTS = [
  ['ventes', 'Ventes'], ['articles', 'Articles'], ['dettes', 'Dettes'],
  ['paiements', 'Paiements des clients'], ['depenses', 'Dépenses'], ['caisse', 'Journal de caisse'],
];

// Section « Compte » (seulement avec un serveur) : e-mail, synchronisation, déconnexion, suppression.
async function sectionCompte() {
  if (!api.serveurActif()) return null;
  const compte = await api.compte();
  const LIBELLES = {
    synchronise: 'Tout est enregistré sur ton compte', attente: 'En attente d’envoi', envoi: 'Envoi en cours…',
    horsligne: 'Hors-ligne : envoi au retour d’internet', reconnexion: 'Reconnecte-toi pour envoyer tes données',
    erreur: 'Envoi impossible pour le moment (nouvel essai automatique)', local: 'Sur cet appareil seulement',
  };
  const etat = h('span', { class: 'etat-sync', 'aria-live': 'polite' });
  const arreter = api.surSynchronisation(({ statut, enAttente }) => {
    if (!etat.isConnected && etat.dataset.etat) { arreter(); return; }
    etat.dataset.etat = statut;
    etat.textContent = LIBELLES[statut] + (enAttente && statut !== 'synchronise' ? ` (${enAttente})` : '');
  });

  const synchroniser = h('button', { class: 'btn btn-neutre btn-bloc', type: 'button' }, icone('nuage', 20), 'Synchroniser maintenant');
  synchroniser.addEventListener('click', enCours(synchroniser, async () => {
    try { const reste = await api.synchroniserMaintenant(); toast(reste ? `${reste} opération(s) encore en attente.` : 'Tout est à jour.'); } catch (e) { erreur(e); }
  }));

  const deconnecter = h('button', { class: 'btn btn-secondaire btn-bloc', type: 'button' }, 'Se déconnecter');
  deconnecter.addEventListener('click', enCours(deconnecter, async () => {
    const attente = await api.operationsEnAttente();
    const ok = await confirmer(attente
      ? { titre: 'Données pas encore envoyées', message: `${attente} opération(s) n’ont pas encore été envoyées à ton compte (pas d’internet ?). Si tu te déconnectes maintenant, elles seront perdues.`, ok: 'Se déconnecter quand même', danger: true }
      : { titre: 'Se déconnecter ?', message: 'Tes données restent sur ton compte. Tu les retrouveras en te reconnectant.', ok: 'Se déconnecter' });
    if (!ok) return;
    try { await api.deconnexion(); location.hash = '#/vendre'; } catch (e) { erreur(e); }
  }));

  const supprimer = h('button', { class: 'btn-texte-danger btn-bloc', type: 'button' }, icone('corbeille', 20), ' Supprimer mon compte');
  supprimer.addEventListener('click', enCours(supprimer, async () => {
    const ok1 = await confirmer({ titre: 'Supprimer ton compte ?', message: 'Ta boutique, tes articles, ventes, factures, dettes et dépenses seront supprimés définitivement, sur ce téléphone et sur le serveur.', ok: 'Continuer', danger: true });
    if (!ok1) return;
    const ok2 = await confirmer({ titre: 'Dernière confirmation', message: 'Cette action ne peut pas être annulée.', ok: 'Oui, supprimer mon compte', danger: true });
    if (!ok2) return;
    try { await api.supprimerCompte(); toast('Ton compte a été supprimé.'); location.hash = '#/vendre'; } catch (e) { erreur(e); }
  }));

  return [
    h('div', { class: 'section-titre' }, h('h2', { class: 'sous-titre' }, 'Compte')),
    h('div', { class: 'carte pile' },
      compte ? h('div', {}, h('p', { class: 'legende' }, 'Connecté avec'), h('p', { style: 'font-weight:600;overflow-wrap:anywhere' }, compte.email))
        : h('p', { class: 'negatif' }, 'Session expirée : reconnecte-toi pour envoyer tes données.'),
      etat,
      synchroniser,
      compte ? deconnecter : h('button', { class: 'btn btn-principal btn-bloc', onclick: reconnecter }, 'Se reconnecter'),
      compte ? supprimer : null),
  ];
}

// Session expirée : se reconnecter SANS effacer les données de l'appareil (elles partent ensuite).
function reconnecter() {
  const email = saisie({ type: 'email', inputmode: 'email', autocomplete: 'email', autocapitalize: 'off', 'aria-label': 'Adresse e-mail' });
  const mdp = saisie({ type: 'password', autocomplete: 'current-password', 'aria-label': 'Mot de passe' });
  const ok = h('button', { class: 'btn btn-principal btn-bloc btn-grand', type: 'submit' }, 'Se reconnecter');
  const form = h('form', { class: 'pile', novalidate: true }, champ('E-mail', email), champ('Mot de passe', mdp), ok);
  const f = ouvrirFeuille({ titre: 'Se reconnecter', contenu: form });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    enCours(ok, async () => {
      try { await api.connexion(email.value, mdp.value); f.fermer(); toast('Reconnecté. Envoi de tes données…'); } catch (err) { erreur(err); }
    })();
  });
}

export async function afficher(racine) {
  const [p, articles] = await Promise.all([api.profil(), api.listerArticles()]);
  let devise = p.devise_principale;

  const nom = saisieLongue({ value: p.nom_boutique, maxlength: 60, autocapitalize: 'words', 'aria-label': 'Nom de la boutique' });
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

  const effacer = h('button', { class: 'btn-texte-danger btn-bloc' }, icone('corbeille', 20), api.serveurActif() ? ' Tout effacer (téléphone et compte)' : ' Tout effacer sur cet appareil');
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
    await sectionCompte(),
    h('div', { class: 'section-titre' }, h('h2', { class: 'sous-titre' }, 'Apparence')),
    h('div', { class: 'carte pile-serree' },
      segment([{ id: 'clair', libelle: 'Clair' }, { id: 'sombre', libelle: 'Sombre' }, { id: 'auto', libelle: 'Automatique' }],
        window.cintreApparence?.lire() ?? 'clair', (choix) => window.cintreApparence?.choisir(choix), { libelle: 'Apparence' }),
      h('p', { class: 'champ-aide' }, 'Automatique suit le réglage du téléphone. Ce choix est gardé sur cet appareil.')),
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
    h('p', { class: 'legende', style: 'text-align:center;margin-top:24px' }, `${CONFIG.nomApp} ${CONFIG.version} · ${api.serveurActif() ? 'données sur ton compte et sur cet appareil' : 'données enregistrées sur cet appareil'}`));
}
