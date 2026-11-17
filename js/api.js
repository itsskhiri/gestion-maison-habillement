// SEULE porte d'accès aux données pour les écrans.
// Les écrans appellent uniquement ces fonctions (toutes asynchrones). Aucun écran ne touche
// à la base, au moteur ou (plus tard) à Supabase directement : pour changer de serveur,
// seule cette couche change.
//
// Fonctionnement : le moteur local applique les règles et enregistre sur l'appareil (IndexedDB),
// donc tout marche sans internet. Si un serveur est configuré (config.js), chaque opération est
// aussi mise dans la file d'attente, puis envoyée au serveur par sync.js.

import * as db from './db.js';
import * as m from './moteur.js';
import * as serveur from './serveur.js';
import * as sync from './sync.js';
import { definirFuseau, aujourdhui, ajouterJours, ajouterMois, cleJour, debutSemaine } from './temps.js';
import { DEVISES } from './money.js';
import { genererExemples } from './exemples.js';

let etat = m.etatVide();
const abonnes = new Set();

export const ErreurMetier = m.ErreurMetier;
export const surChangement = (fn) => { abonnes.add(fn); return () => abonnes.delete(fn); };
const notifier = () => abonnes.forEach((fn) => fn());

export async function initialiser() {
  etat = await db.chargerTout();
  definirFuseau(etat.profil?.fuseau);
  // Ventes enregistrées avant la numérotation des factures : on leur donne un numéro une fois.
  const { changes } = m.numeroterVentes(etat);
  if (Object.keys(changes).length) await db.enregistrer(changes, operationPour(changes));
  db.demanderStockagePersistant();
  sync.quandRecu(recharger);
  if (serveur.actif()) {
    const s = await serveur.session().catch(() => null);
    if (s) await preparerCompte(s);
  }
  sync.demarrer();
  return { memoireSeulement: db.modeMemoire };
}

// Recharge l'état depuis l'appareil (après réception de données du serveur).
async function recharger() {
  etat = await db.chargerTout();
  definirFuseau(etat.profil?.fuseau);
  notifier();
}

// Opération à envoyer au serveur (seulement si un serveur est configuré).
let compteurOperations = Date.now() * 1000;
function operationPour(changes) {
  if (!serveur.actif()) return null;
  return { id: m.uuid(), numero: compteurOperations++, cree_le: new Date().toISOString(), changes: structuredClone(changes) };
}

// Exécute une opération du moteur puis l'enregistre en une transaction (+ file d'attente).
async function executer(operation) {
  const { changes, resultat } = operation(etat);
  if (Object.keys(changes).length) {
    try {
      await db.enregistrer(changes, operationPour(changes));
      sync.demander();
    } catch (e) {
      etat = await db.chargerTout(); // on revient à l'état réellement enregistré
      throw new Error("L'enregistrement a échoué sur cet appareil. Réessaie.", { cause: e });
    }
    notifier();
  }
  return structuredClone(resultat);
}

const lire = async (fn) => structuredClone(fn(etat));

/* ---------- Boutique ---------- */

export const profil = () => lire((e) => e.profil);
export const creerBoutique = (entree) => executer((e) => m.creerProfil(e, entree));
export async function modifierProfil(champs) {
  const r = await executer((e) => m.modifierProfil(e, champs));
  definirFuseau(r.fuseau);
  return r;
}
export const changerTaux = (taux) => executer((e) => m.modifierProfil(e, { taux }));

/* ---------- Articles ---------- */

export const listerArticles = () => lire((e) =>
  m.articlesActifs(e).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')));
export const ajouterArticle = (entree) => executer((e) => m.ajouterArticle(e, entree));
export const modifierArticle = (id, champs) => executer((e) => m.modifierArticle(e, id, champs));
export const ajusterStock = (id, delta) => executer((e) => m.ajusterStock(e, id, delta));
export const supprimerArticle = (id) => executer((e) => m.supprimerArticle(e, id));

/* ---------- Clients ---------- */

export const listerClients = () => lire((e) => e.clients.slice().sort((a, b) => a.nom.localeCompare(b.nom, 'fr')));

/* ---------- Ventes ---------- */

export const creerVente = (entree) => executer((e) => m.creerVente(e, entree));
export const annulerVente = (id) => executer((e) => m.annulerVente(e, id));
export const detailVente = (id) => lire((e) => m.detailVente(e, id));
export const listerVentes = (limite = 300) => lire((e) =>
  e.ventes.slice().sort((a, b) => b.cree_le.localeCompare(a.cree_le)).slice(0, limite).map((v) => ({
    vente: v,
    lignes: e.lignes_de_vente.filter((l) => l.vente_id === v.id),
    client: e.clients.find((c) => c.id === v.client_id) || null,
  })));

/* ---------- Dettes ---------- */

export const dettesParClient = () => lire((e) => m.dettesParClient(e));
export const ficheClient = (id) => lire((e) => m.ficheClient(e, id));
export const totalARecevoir = () => lire((e) => m.totalARecevoir(e));
export const recupereCeMois = () => lire((e) => {
  const j = aujourdhui();
  return m.recuperePeriode(e, j.slice(0, 7) + '-01', j);
});
export const encaisserPaiement = (entree) => executer((e) => m.encaisserPaiement(e, entree));
export const annulerPaiement = (id) => executer((e) => m.annulerPaiement(e, id));
export const paiement = (id) => lire((e) => {
  const p = e.paiements_dette.find((x) => x.id === id);
  return p ? { paiement: p, client: e.clients.find((c) => c.id === p.client_id) } : null;
});

/* ---------- Dépenses ---------- */

export const ajouterDepense = (entree) => executer((e) => m.ajouterDepense(e, entree));
export const modifierDepense = (id, champs) => executer((e) => m.modifierDepense(e, id, champs));
export const annulerDepense = (id) => executer((e) => m.annulerDepense(e, id));
export const depense = (id) => lire((e) => e.depenses.find((d) => d.id === id) || null);
export const listerDepenses = (debut, fin) => lire((e) => e.depenses
  .filter((d) => { const c = cleJour(d.cree_le); return c >= debut && c <= fin; })
  .sort((a, b) => b.cree_le.localeCompare(a.cree_le)));

/* ---------- Caisse et rapports ---------- */

// Bornes d'une période : 'jour', '7j', '30j', '12m'. Renvoie la période et la précédente.
export function bornesPeriode(periode, ref = aujourdhui()) {
  if (periode === '12m') {
    const debut = ajouterMois(ref.slice(0, 7), -11) + '-01';
    const precDebut = ajouterMois(ref.slice(0, 7), -23) + '-01';
    return { debut, fin: ref, precDebut, precFin: ajouterJours(debut, -1) };
  }
  const n = { jour: 1, '7j': 7, '30j': 30 }[periode] || 1;
  const debut = ajouterJours(ref, -(n - 1));
  return { debut, fin: ref, precDebut: ajouterJours(debut, -n), precFin: ajouterJours(debut, -1) };
}

export const statsPeriode = (debut, fin) => lire((e) => m.statsPeriode(e, debut, fin));

// Factures d'un jour, d'une semaine (lundi → dimanche) ou d'un mois ; `decalage` recule de N périodes.
export function bornesFactures(periode, decalage = 0, ref = aujourdhui()) {
  if (periode === 'semaine') {
    const debut = ajouterJours(debutSemaine(ref), 7 * decalage);
    return { debut, fin: ajouterJours(debut, 6) };
  }
  if (periode === 'mois') {
    const mois = ajouterMois(ref.slice(0, 7), decalage);
    return { debut: mois + '-01', fin: ajouterJours(ajouterMois(mois, 1) + '-01', -1) };
  }
  const jour = ajouterJours(ref, decalage);
  return { debut: jour, fin: jour };
}
export const factures = (debut, fin) => lire((e) => m.factures(e, debut, fin));
export const soldeCaisse = () => lire((e) => m.soldeCaisse(e));
export const journalCaisse = (debut, fin, filtre) => lire((e) => m.journalCaisse(e, debut, fin, filtre));
export const ventesParCategorie = (debut, fin) => lire((e) => m.ventesParCategorie(e, debut, fin));
export const meilleuresVentes = (debut, fin) => lire((e) => m.meilleuresVentes(e, debut, fin));
export const bientotEnRupture = () => lire((e) => m.bientotEnRupture(e));
export const rapportDuJour = (cle) => lire((e) => m.rapportDuJour(e, cle));
export const activiteParJour = () => lire((e) => m.activiteParJour(e));
export const premiereActivite = () => lire((e) => m.premiereActivite(e));

// Série du graphique d'une période (heures pour « Aujourd'hui », jours, ou mois pour « 12 mois »).
export function serieGraphique(periode) {
  const { debut, fin } = bornesPeriode(periode);
  let cases;
  if (periode === 'jour') {
    cases = Array.from({ length: 24 }, (_, h) => ({ cle: String(h), jour: fin, libelle: `${h} h` }));
  } else if (periode === '12m') {
    cases = Array.from({ length: 12 }, (_, i) => {
      const mois = ajouterMois(debut.slice(0, 7), i);
      return { cle: mois, mois: true, libelle: mois };
    });
  } else {
    const n = periode === '7j' ? 7 : 30;
    cases = Array.from({ length: n }, (_, i) => { const j = ajouterJours(debut, i); return { cle: j, libelle: j }; });
  }
  return lire((e) => m.serie(e, cases, periode === 'jour'));
}

/* ---------- Données ---------- */

export async function chargerExemples() {
  if (etat.ventes.length || etat.articles.length) {
    throw new m.ErreurMetier('Des données existent déjà. Efface tout avant de charger les exemples.');
  }
  const changes = genererExemples(etat);
  await db.enregistrer(changes, operationPour(changes));
  sync.demander();
  notifier();
}

export async function toutEffacer({ garderBoutique = false } = {}) {
  const p = etat.profil;
  if (serveur.actif()) {
    if (!navigator.onLine) throw new m.ErreurMetier('Connecte-toi à internet pour effacer les données de ton compte.');
    await sync.synchroniser().catch(() => {});
    await serveur.effacerMesDonnees(garderBoutique);
  }
  await db.toutEffacer();
  etat = m.etatVide();
  if (garderBoutique && p) {
    etat.profil = p;
    await db.enregistrer({ profil: [p] });
  }
  await sync.compterAttente();
  notifier();
}

/* =================== Compte et synchronisation =================== */

export const serveurActif = () => serveur.actif();
export const surSynchronisation = (fn) => sync.surStatut(fn);
export const synchroniserMaintenant = () => sync.synchroniser();

export async function compte() {
  if (!serveur.actif()) return null;
  const s = await serveur.session().catch(() => null);
  return s ? { email: s.user.email, id: s.user.id } : null;
}

// Prépare l'appareil pour le compte connecté :
//   - même compte qu'avant : on envoie ce qui attend et on reçoit les nouveautés ;
//   - nouvel appareil (ou autre compte) : on récupère toutes les données du compte ;
//   - compte tout neuf : on y envoie les données déjà saisies sur l'appareil (s'il y en a),
//     sinon on crée la boutique avec les informations données à l'inscription.
async function preparerCompte(session) {
  const uid = session.user.id;
  const precedent = await db.lireMeta('utilisateur');
  if (precedent === uid) { sync.demander(0); return; }

  const { changes, curseur } = await serveur.lireDepuis(null);
  const serveurAUneBoutique = (changes.profil || []).length > 0;
  if (serveurAUneBoutique) {
    await db.toutEffacer();
    await db.appliquerDistant(changes);
  } else if (precedent && precedent !== uid) {
    await db.toutEffacer(); // données d'un autre compte sur cet appareil
  }
  await db.ecrireMeta('utilisateur', uid);
  if (curseur) await db.ecrireMeta('curseur', curseur);
  etat = await db.chargerTout();

  if (!serveurAUneBoutique) {
    if (etat.profil) {
      // Données saisies sur l'appareil avant la création du compte : on les envoie toutes.
      const tout = {};
      for (const t of m.TABLES) {
        const lignes = t === 'profil' ? [etat.profil] : etat[t];
        if (lignes.length) tout[t] = lignes;
      }
      await db.enregistrer({ profil: [etat.profil] }, operationPour(tout));
    } else {
      const b = session.user.user_metadata?.boutique;
      if (b?.nom_boutique) {
        const { changes: c } = m.creerProfil(etat, b);
        await db.enregistrer(c, operationPour(c));
      }
    }
  }
  definirFuseau(etat.profil?.fuseau);
  sync.demander(0);
  notifier();
}

export async function connexion(email, motDePasse) {
  const s = await serveur.connexion(email.trim(), motDePasse);
  await preparerCompte(s);
}

// Création du compte. La boutique est gardée avec le compte (pour la créer à la 1re connexion
// si une confirmation par e-mail est demandée).
export async function creerCompte({ email, motDePasse, boutique }) {
  if (!motDePasse || motDePasse.length < 8) throw new m.ErreurMetier('Le mot de passe doit avoir au moins 8 caractères.');
  m.creerProfil(m.etatVide(), boutique); // vérifie la boutique avant d'appeler le serveur
  const r = await serveur.creerCompte({ email: email.trim(), motDePasse, boutique });
  if (r.session) await preparerCompte(r.session);
  return { confirmationNecessaire: r.confirmationNecessaire };
}

export const renvoyerConfirmation = (email) => serveur.renvoyerConfirmation(email.trim());
export const motDePasseOublie = (email) => serveur.motDePasseOublie(email.trim());
export async function changerMotDePasse(motDePasse) {
  if (!motDePasse || motDePasse.length < 8) throw new m.ErreurMetier('Le mot de passe doit avoir au moins 8 caractères.');
  await serveur.changerMotDePasse(motDePasse);
}
export const surChangementSession = (fn) => { if (serveur.actif()) serveur.surChangementSession(fn); };

export const operationsEnAttente = async () => (await db.fileAttente()).length;

// Déconnexion : les données de cet appareil sont effacées (elles restent sur le serveur).
export async function deconnexion() {
  await serveur.deconnexion();
  await db.toutEffacer();
  await db.ecrireMeta('utilisateur', null);
  await db.ecrireMeta('curseur', null);
  etat = m.etatVide();
  await sync.compterAttente();
  notifier();
}

export async function supprimerCompte() {
  if (!navigator.onLine) throw new m.ErreurMetier('Connecte-toi à internet pour supprimer ton compte.');
  await serveur.supprimerMonCompte();
  await db.toutEffacer();
  await db.ecrireMeta('utilisateur', null);
  await db.ecrireMeta('curseur', null);
  etat = m.etatVide();
  notifier();
}

export const exporterCSV = (table) => lire((e) => exporter(e, table));

// Montant exporté en unités lisibles : 1250 centimes -> « 12.50 ».
function enClair(unites, devise) {
  const f = 10 ** DEVISES[devise].decimales;
  if (f === 1) return String(unites);
  const s = unites < 0 ? '-' : '';
  const a = Math.abs(unites);
  return `${s}${Math.floor(a / f)}.${String(a % f).padStart(2, '0')}`;
}

function exporter(e, table) {
  const nomClient = (id) => e.clients.find((c) => c.id === id)?.nom || '';
  const dp = e.profil.devise_principale;
  const L = {
    articles: [['nom', 'prix_achat', 'devise', 'stock', 'categorie'],
      ...m.articlesActifs(e).map((a) => [a.nom, enClair(a.prix_achat, a.devise), a.devise, a.quantite, a.categorie || ''])],
    ventes: [['date', 'vente', 'statut', 'client', 'article', 'quantite', `cout_achat_${dp}`, `prix_vente_${dp}`, `benefice_${dp}`, 'taux', 'annulee'],
      ...e.lignes_de_vente.map((l) => {
        const v = e.ventes.find((x) => x.id === l.vente_id);
        return [v.cree_le, v.id, v.statut, nomClient(v.client_id), l.nom, l.quantite, enClair(l.cout_principal, dp),
          enClair(l.montant_principal, dp), enClair(l.montant_principal - l.cout_principal, dp), v.taux, v.annule_le || ''];
      })],
    dettes: [['date', 'client', 'montant_vente', 'acompte', 'du', 'reste', 'devise', 'annulee'],
      ...e.dettes.map((d) => [d.cree_le, nomClient(d.client_id), enClair(d.montant_vente, d.devise), enClair(d.acompte, d.devise),
        enClair(d.montant, d.devise), enClair(m.resteDette(e, d), d.devise), d.devise, d.annule_le || ''])],
    paiements: [['date', 'client', 'montant_recu', 'devise_recue', 'montant_impute', 'devise_dette', 'taux', 'mode', 'note', 'annule'],
      ...e.paiements_dette.map((p) => [p.cree_le, nomClient(p.client_id), enClair(p.montant_recu, p.devise_recue), p.devise_recue,
        enClair(p.montant, p.devise), p.devise, p.taux, p.mode, p.note || '', p.annule_le || ''])],
    depenses: [['date', 'type', 'montant', 'devise', 'mode', 'note', 'annulee'],
      ...e.depenses.map((d) => [d.cree_le, d.type, enClair(d.montant, d.devise), d.devise, d.mode, d.note || '', d.annule_le || ''])],
    caisse: [['date', 'type', 'libelle', 'montant', 'devise', 'mode', 'annule'],
      ...m.journalCaisse(e, '0000-01-01', '9999-12-31').map((x) => [x.cree_le, x.type, x.libelle, enClair(x.montant, x.devise), x.devise, x.mode, x.annule_le || ''])],
  }[table];
  const cellule = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + L.map((ligne) => ligne.map(cellule).join(';')).join('\r\n');
}
