// SEULE porte d'accès aux données pour les écrans.
// Les écrans appellent uniquement ces fonctions (toutes asynchrones). Aucun écran ne touche
// à la base, au moteur ou (plus tard) à Supabase directement : pour changer de serveur,
// seule cette couche change.
//
// Étape 1 : les données vivent sur l'appareil (IndexedDB) et le moteur local applique les règles.

import * as db from './db.js';
import * as m from './moteur.js';
import { definirFuseau, aujourdhui, ajouterJours, ajouterMois, cleJour } from './temps.js';
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
  db.demanderStockagePersistant();
  return { memoireSeulement: db.modeMemoire };
}

// Exécute une opération du moteur puis l'enregistre en une transaction.
async function executer(operation) {
  const { changes, resultat } = operation(etat);
  if (Object.keys(changes).length) {
    try {
      await db.enregistrer(changes);
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
  await db.enregistrer(changes);
  notifier();
}

export async function toutEffacer({ garderBoutique = false } = {}) {
  const p = etat.profil;
  await db.toutEffacer();
  etat = m.etatVide();
  if (garderBoutique && p) {
    etat.profil = p;
    await db.enregistrer({ profil: [p] });
  }
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
  const L = {
    articles: [['nom', 'prix', 'devise', 'stock', 'categorie'],
      ...m.articlesActifs(e).map((a) => [a.nom, enClair(a.prix, a.devise), a.devise, a.quantite, a.categorie || ''])],
    ventes: [['date', 'vente', 'statut', 'client', 'article', 'quantite', 'prix_unitaire', 'devise', 'taux', 'annulee'],
      ...e.lignes_de_vente.map((l) => {
        const v = e.ventes.find((x) => x.id === l.vente_id);
        return [v.cree_le, v.id, v.statut, nomClient(v.client_id), l.nom, l.quantite, enClair(l.prix_unitaire, v.devise), v.devise, v.taux, v.annule_le || ''];
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
