// Tests automatiques du moteur métier (ouvrir tests/index.html via un serveur local).
// Ils reprennent les scénarios obligatoires du cahier des charges.
// Rappel : le prix d'un article est son PRIX D'ACHAT ; le prix de vente est saisi à chaque vente.

import * as m from '../js/moteur.js';
import { convertir, lireMontant, formater, divArrondi } from '../js/money.js';
import { isoPourJour, cleJour, definirFuseau, ajouterJours } from '../js/temps.js';
import { genererExemples } from '../js/exemples.js';

const sortie = document.getElementById('resultats');
let reussis = 0;
let rates = 0;

function test(nom, fn) {
  try {
    fn();
    reussis++;
    sortie.insertAdjacentHTML('beforeend', `<span class="ok">✔ ${nom}</span>\n`);
  } catch (e) {
    rates++;
    sortie.insertAdjacentHTML('beforeend', `<span class="ko">✘ ${nom}\n    ${e.message}</span>\n`);
  }
}
function egal(obtenu, attendu, quoi = '') {
  if (JSON.stringify(obtenu) !== JSON.stringify(attendu)) {
    throw new Error(`${quoi} attendu ${JSON.stringify(attendu)}, obtenu ${JSON.stringify(obtenu)}`);
  }
}
function refuse(fn, motif) {
  try { fn(); } catch (e) {
    if (!(e instanceof m.ErreurMetier)) throw new Error('Erreur inattendue : ' + e.message);
    if (motif && !e.message.includes(motif)) throw new Error(`Message inattendu : ${e.message}`);
    return;
  }
  throw new Error("L'opération aurait dû être refusée");
}

definirFuseau('Africa/Lubumbashi');
const J = (cle, h = 12, mn = 0) => ({ date: isoPourJour(cle, h, mn) });
const TOUT = ['0000-01-01', '9999-12-31'];

// Boutique en francs, taux 2 850 : robe achetée 30 000 FC, jean acheté 12 $.
function boutique(devise = 'CDF') {
  const e = m.etatVide();
  m.creerProfil(e, { nom_boutique: 'Boutique Test', devise_principale: devise, taux: 2850 });
  const robe = m.ajouterArticle(e, { nom: 'Robe', prix_achat: 30000, devise: 'CDF', quantite: 5, categorie: 'robes' }).resultat;
  const jean = m.ajouterArticle(e, { nom: 'Jean', prix_achat: 1200, devise: 'USD', quantite: 2, categorie: 'pantalons' }).resultat;
  return { e, robe, jean };
}
const solde = (e) => m.soldeCaisse(e);
// Vente d'un seul produit : `total` = quantité × prix d'une pièce (devise de la vente, francs par défaut).
const vendre = (e, article, quantite, total, extra = {}, opts) =>
  m.creerVente(e, { lignes: [{ article_id: article.id, quantite, prix_unitaire: total / quantite }], ...extra }, opts).resultat;

/* ---------- Montants exacts ---------- */

test('Montants : lecture et affichage exacts', () => {
  egal(lireMontant('12,50', 'USD'), 1250);
  egal(lireMontant('25 000', 'CDF'), 25000);
  egal(lireMontant('12,5', 'USD'), 1250);
  egal(lireMontant('0,1', 'USD'), 10);
  egal(lireMontant('12,345', 'USD'), null, 'trop de décimales');
  egal(lireMontant('12,5', 'CDF'), null, 'pas de centimes en FC');
  egal(lireMontant('abc', 'CDF'), null);
  egal(formater(1250, 'USD'), '12,50 $');
  egal(formater(2500000, 'CDF'), '2 500 000 FC');
  egal(formater(-3000, 'CDF'), '−3 000 FC');
});

test('Conversions : arrondi au plus proche, sans virgule flottante', () => {
  egal(convertir(1000, 'USD', 'CDF', 2850), 28500);
  egal(convertir(28500, 'CDF', 'USD', 2850), 1000);
  egal(convertir(30000, 'CDF', 'USD', 2850), 1053);
  egal(convertir(1001, 'USD', 'CDF', 2850), 28529);
  egal(divArrondi(5, 2), 3);
  egal(divArrondi(-5, 2), -3);
  egal(lireMontant('0,1', 'USD') + lireMontant('0,2', 'USD'), 30);
});

test('Fuseau : une vente à 23 h 30 à Bukavu compte bien pour ce jour-là', () => {
  const iso = isoPourJour('2026-11-10', 23, 30);
  egal(iso, '2026-11-10T21:30:00.000Z');
  egal(cleJour(iso), '2026-11-10');
  egal(cleJour('2026-11-10T22:30:00.000Z'), '2026-11-11');
});

/* ---------- Prix d'achat et prix de vente négocié ---------- */

test('Prix de vente de chaque produit : obligatoire, entier, positif', () => {
  const { e, robe } = boutique();
  refuse(() => m.creerVente(e, { lignes: [{ article_id: robe.id, quantite: 1 }] }), 'prix de vente');
  refuse(() => vendre(e, robe, 1, 0));
  refuse(() => vendre(e, robe, 1, 40000.5));
  egal(robe.quantite, 5, 'rien n’a changé');
});

test('Vente invalide si un produit est vendu sous son prix d’achat (même un seul sur plusieurs)', () => {
  const { e, robe, jean } = boutique();
  refuse(() => vendre(e, robe, 1, 29999), 'Vente invalide');
  // jean acheté 12 $ = 34 200 FC : 34 199 FC refusé, 34 200 accepté
  refuse(() => m.creerVente(e, { lignes: [
    { article_id: robe.id, quantite: 1, prix_unitaire: 45000 },
    { article_id: jean.id, quantite: 1, prix_unitaire: 34199 },
  ] }), 'Jean');
  egal(e.ventes.length, 0, 'rien n’est enregistré');
  vendre(e, jean, 1, 34200);
  egal(e.ventes.length, 1, 'vendu exactement au prix d’achat : accepté');
});

test('Vente négociée : caisse = prix convenu, bénéfice = prix − prix d’achat', () => {
  const { e, robe } = boutique();
  // 2 robes achetées 30 000 FC chacune, vendues 75 000 FC les deux après discussion
  const v = vendre(e, robe, 2, 75000);
  egal(v.total, 75000);
  egal(v.cout_principal, 60000);
  egal(robe.quantite, 3);
  egal(solde(e).CDF, 75000);
  const s = m.statsPeriode(e, ...TOUT);
  egal([s.ventes, s.cout, s.marge, s.benefice], [75000, 60000, 15000, 15000]);
  // Changer le prix d'achat plus tard ne change pas le passé
  m.modifierArticle(e, robe.id, { prix_achat: 40000 });
  egal(m.statsPeriode(e, ...TOUT).cout, 60000);
  egal(e.lignes_de_vente[0].nom, 'Robe');
});

test('Article acheté en dollars, vendu en francs : coût converti au taux de la vente', () => {
  const { e, jean } = boutique();
  const v = vendre(e, jean, 1, 50000, { taux: 2900 });
  egal(v.cout_principal, 34800); // 12 $ × 2 900
  egal(m.statsPeriode(e, ...TOUT).marge, 15200);
});

test('Plusieurs produits, chacun avec son prix : total, bénéfice et catégories exacts', () => {
  const { e, robe, jean } = boutique();
  const v = m.creerVente(e, { lignes: [
    { article_id: robe.id, quantite: 2, prix_unitaire: 40000 },
    { article_id: jean.id, quantite: 1, prix_unitaire: 45000 },
  ] }).resultat;
  egal(v.total, 125000);
  egal(m.statsPeriode(e, ...TOUT).benefice, 125000 - 60000 - 34200);
  const cats = m.ventesParCategorie(e, ...TOUT);
  egal(cats.map((c) => [c.id, c.valeur]), [['robes', 80000], ['pantalons', 45000]]);
  egal(e.lignes_de_vente.map((l) => l.prix_unitaire), [40000, 45000], 'prix de chaque produit conservés');
});

test('Vente $ + FC : un produit en dollars, un en francs -> total dollars et total francs', () => {
  const { e, robe, jean } = boutique();
  const v = m.creerVente(e, { lignes: [
    { article_id: robe.id, quantite: 2, prix_unitaire: 40000, devise: 'CDF' },
    { article_id: jean.id, quantite: 1, prix_unitaire: 1500, devise: 'USD' },
  ], paiement: { type: 'payee', encaissements: [{ devise: 'CDF', montant: 80000 }, { devise: 'USD', montant: 1500 }] } }).resultat;
  egal(v.totaux, { USD: 1500, CDF: 80000 });
  egal(solde(e).USD, 1500, 'dollars en caisse');
  egal(solde(e).CDF, 80000, 'francs en caisse');
  const s = m.statsPeriode(e, ...TOUT);
  egal(s.ventes, 80000 + 42750, 'ventes dans la devise principale');
  egal(s.benefice, 80000 + 42750 - 60000 - 34200);
  // un jean vendu 11 $ (sous 12 $) en ligne dollars : refusé
  refuse(() => m.creerVente(e, { lignes: [{ article_id: jean.id, quantite: 1, prix_unitaire: 1100, devise: 'USD' }] }), 'Vente invalide');
});

test('Vente $ + FC à crédit : une dette en dollars et une en francs, acompte dans sa devise', () => {
  const { e, robe, jean } = boutique();
  const v = m.creerVente(e, { lignes: [
    { article_id: robe.id, quantite: 1, prix_unitaire: 45000, devise: 'CDF' },
    { article_id: jean.id, quantite: 1, prix_unitaire: 2000, devise: 'USD' },
  ], paiement: { type: 'credit', client: { nom: 'Aline' }, acompte: { devise: 'USD', montant: 500, mode: 'cash' } } }).resultat;
  const fiche = m.ficheClient(e, v.client_id);
  egal(fiche.reste, { USD: 1500, CDF: 45000 });
  egal(solde(e).USD, 500, 'acompte en dollars dans la caisse');
  refuse(() => m.creerVente(e, { lignes: [
    { article_id: robe.id, quantite: 1, prix_unitaire: 45000, devise: 'CDF' },
    { article_id: jean.id, quantite: 1, prix_unitaire: 2000, devise: 'USD' },
  ], paiement: { type: 'credit', client: { nom: 'Aline' }, acompte: { devise: 'USD', montant: 2001 } } }), 'dépasse');
  // annuler la vente annule les deux dettes
  m.annulerVente(e, v.id);
  egal(m.totalARecevoir(e), { USD: 0, CDF: 0 });
});

test('Un produit payé en partie en $ et en partie en FC (taux de la vente)', () => {
  const { e, jean } = boutique('USD');
  // Jean acheté 12 $, vendu 16 $ : 10 $ + 6 $ en francs (6 × 2 850 = 17 100 FC)
  const v = m.creerVente(e, { devise: 'USD', lignes: [{ article_id: jean.id, quantite: 1, montants: { USD: 1000, CDF: 17100 } }] }).resultat;
  egal(v.totaux, { USD: 1000, CDF: 17100 });
  egal(solde(e).USD, 1000);
  egal(solde(e).CDF, 17100);
  egal(m.statsPeriode(e, ...TOUT).benefice, 400, 'bénéfice 4 $');
  // 10 $ + 5 000 FC (≈ 1,75 $) = 11,75 $ < 12 $ : invalide
  refuse(() => m.creerVente(e, { devise: 'USD', lignes: [{ article_id: jean.id, quantite: 1, montants: { USD: 1000, CDF: 5000 } }] }), 'Vente invalide');
  // le taux de la vente compte : à 2 000 FC le dollar, 10 $ + 4 000 FC = 12 $ : valide
  m.creerVente(e, { devise: 'USD', taux: 2000, lignes: [{ article_id: jean.id, quantite: 1, montants: { USD: 1000, CDF: 4000 } }] });
  refuse(() => m.creerVente(e, { devise: 'USD', lignes: [{ article_id: jean.id, quantite: 1, montants: { USD: 0, CDF: 0 } }] }), 'Saisis');
});

test('Paiement $ + FC par produit, à crédit : une dette par devise', () => {
  const { e, robe, jean } = boutique();
  const v = m.creerVente(e, { lignes: [
    { article_id: robe.id, quantite: 1, montants: { USD: 0, CDF: 40000 } },
    { article_id: jean.id, quantite: 1, montants: { USD: 1000, CDF: 17100 } },
  ], paiement: { type: 'credit', client: { nom: 'Bahati' } } }).resultat;
  egal(m.ficheClient(e, v.client_id).reste, { USD: 1000, CDF: 57100 });
});

test('Factures : numérotées 1, 2, 3…, liées aux dettes, listées par période', () => {
  const { e, robe } = boutique();
  const v1 = vendre(e, robe, 1, 45000, {}, J('2026-11-09', 10));                 // lundi
  const v2 = vendre(e, robe, 1, 46000, { paiement: { type: 'credit', client: { nom: 'Ciza' } } }, J('2026-11-12', 11));
  const v3 = vendre(e, robe, 1, 47000, {}, J('2026-11-16', 9));                  // lundi suivant
  egal([v1.numero, v2.numero, v3.numero], [1, 2, 3]);
  m.annulerVente(e, v3.id);
  egal(vendre(e, robe, 1, 45000, {}, J('2026-11-16', 15)).numero, 4, 'un numéro annulé n’est jamais réutilisé');
  // Dette de Ciza liée à la facture n° 2
  const ciza = m.dettesParClient(e).find((c) => c.client.nom === 'Ciza');
  egal(ciza.factures, [{ numero: 2, date: v2.cree_le }]);
  egal(m.ficheClient(e, ciza.client.id).historique[0].numero, 2);
  // Semaine du 9 au 15 novembre : factures 1 et 2
  const sem = m.factures(e, '2026-11-09', '2026-11-15');
  egal(sem.liste.map((x) => x.vente.numero), [2, 1]);
  egal([sem.resume.nombre, sem.resume.payees, sem.resume.credit], [2, 1, 1]);
  egal(sem.resume.totaux.CDF, 91000);
  const jour = m.factures(e, '2026-11-16', '2026-11-16');
  egal([jour.resume.nombre, jour.resume.annulees], [1, 1], 'facture annulée listée à part');
});

test('Anciennes ventes sans numéro : numérotées une fois, par ordre de date', () => {
  const { e, robe } = boutique();
  vendre(e, robe, 1, 45000, {}, J('2026-11-02'));
  vendre(e, robe, 1, 45000, {}, J('2026-11-01'));
  for (const v of e.ventes) delete v.numero;
  egal(m.numeroterVentes(e).resultat, 2);
  egal(e.ventes.map((v) => [cleJour(v.cree_le), v.numero]), [['2026-11-02', 2], ['2026-11-01', 1]]);
  egal(m.numeroterVentes(e).resultat, 0, 'rien à refaire');
});

test('Paiement mixte dollars + francs', () => {
  const { e, robe } = boutique();
  // Prix convenu 100 000 FC : le client donne 20 $ (57 000 FC) + 43 000 FC
  vendre(e, robe, 2, 100000, {
    paiement: { type: 'payee', encaissements: [{ devise: 'USD', montant: 2000, mode: 'cash' }, { devise: 'CDF', montant: 43000, mode: 'mpesa' }] },
  });
  egal(solde(e).USD, 2000);
  egal(solde(e).CDF, 43000);
  egal(solde(e).modes.mpesa.CDF, 43000);
  egal(m.statsPeriode(e, ...TOUT).encaisse, 100000);
  refuse(() => vendre(e, robe, 1, 50000, {
    paiement: { type: 'payee', encaissements: [{ devise: 'CDF', montant: 10000, mode: 'cash' }] },
  }), 'ne correspond pas');
});

test('Paiement mixte : arrondi du dollar au centime accepté, vrai écart refusé', () => {
  const { e, robe } = boutique();
  const u = convertir(60000, 'CDF', 'USD', 2850);
  egal(u, 2105);
  vendre(e, robe, 2, 100000, {
    paiement: { type: 'payee', encaissements: [{ devise: 'USD', montant: u, mode: 'cash' }, { devise: 'CDF', montant: 40000, mode: 'cash' }] },
  });
  egal(m.statsPeriode(e, ...TOUT).encaisse, 100000);
  refuse(() => vendre(e, robe, 1, 50000, {
    paiement: { type: 'payee', encaissements: [{ devise: 'USD', montant: 1000, mode: 'cash' }, { devise: 'CDF', montant: 20000, mode: 'cash' }] },
  }), 'ne correspond pas');
});

/* ---------- Stock ---------- */

test('Stock jamais négatif', () => {
  const { e, jean } = boutique();
  refuse(() => vendre(e, jean, 3, 135000), 'Stock insuffisant');
  refuse(() => m.creerVente(e, { lignes: [{ article_id: jean.id, quantite: 2, prix_unitaire: 45000 }, { article_id: jean.id, quantite: 1, prix_unitaire: 45000 }] }), 'Stock insuffisant');
  vendre(e, jean, 2, 90000);
  egal(jean.quantite, 0, 'stock à zéro');
  refuse(() => vendre(e, jean, 1, 45000));
  refuse(() => m.ajusterStock(e, jean.id, -1), 'négatif');
  m.ajusterStock(e, jean.id, 4);
  egal(jean.quantite, 4, 'nouvel arrivage');
});

test('Une vente refusée ne modifie rien (tout ou rien)', () => {
  const { e, robe, jean } = boutique();
  const avant = JSON.stringify(e);
  refuse(() => m.creerVente(e, { lignes: [{ article_id: robe.id, quantite: 1, prix_unitaire: 45000 }, { article_id: jean.id, quantite: 9, prix_unitaire: 45000 }] }));
  egal(JSON.stringify(e), avant);
});

test('Annulation de vente : stock rendu, caisse corrigée, trace conservée', () => {
  const { e, robe } = boutique();
  const v = vendre(e, robe, 1, 45000);
  m.annulerVente(e, v.id);
  egal(robe.quantite, 5);
  egal(solde(e).CDF, 0);
  egal(e.ventes.length, 1, 'la vente reste dans l’historique');
  egal(m.statsPeriode(e, ...TOUT).ventes, 0);
  egal(m.statsPeriode(e, ...TOUT).cout, 0);
});

test('Même identifiant envoyé deux fois : une seule vente (pas de doublon)', () => {
  const { e, robe } = boutique();
  const id = m.uuid();
  m.creerVente(e, { id, lignes: [{ article_id: robe.id, quantite: 1, prix_unitaire: 45000 }] });
  m.creerVente(e, { id, lignes: [{ article_id: robe.id, quantite: 1, prix_unitaire: 45000 }] });
  egal(e.ventes.length, 1);
  egal(robe.quantite, 4);
});

/* ---------- Dettes (scénario obligatoire) ---------- */

test('Dette 50 000 + acompte 10 000 -> paiements 15 000 puis 25 000', () => {
  const { e, robe } = boutique();
  const v = vendre(e, robe, 1, 50000, {
    paiement: { type: 'credit', client: { nom: 'Furaha' }, acompte: { devise: 'CDF', montant: 10000, mode: 'cash' } },
  });
  const cid = v.client_id;
  egal(solde(e).CDF, 10000, 'caisse après acompte');
  egal(m.ficheClient(e, cid).reste.CDF, 40000, 'reste après acompte');

  const r = m.encaisserPaiement(e, { client_id: cid, devise_dette: 'CDF', montant_recu: 15000 }).resultat;
  egal(r.reste_apres, 25000);
  egal(solde(e).CDF, 25000, 'caisse +15 000');

  refuse(() => m.encaisserPaiement(e, { client_id: cid, devise_dette: 'CDF', montant_recu: 25001 }), 'dépasse');

  const p2 = m.encaisserPaiement(e, { client_id: cid, devise_dette: 'CDF', montant_recu: 25000 }).resultat;
  egal(p2.reste_apres, 0);
  egal(solde(e).CDF, 50000, 'caisse +25 000');
  egal(m.ficheClient(e, cid).soldee, true, 'dette soldée');

  m.annulerPaiement(e, p2.paiement.id);
  egal(m.ficheClient(e, cid).reste.CDF, 25000, 'reste corrigé après annulation');
  egal(solde(e).CDF, 25000, 'caisse corrigée après annulation');
});

test('Vente à crédit : n’entre pas dans la caisse, mais compte dans les ventes et le bénéfice', () => {
  const { e, robe } = boutique();
  vendre(e, robe, 1, 50000, { paiement: { type: 'credit', client: { nom: 'Aline' } } });
  egal(solde(e).CDF, 0);
  const s = m.statsPeriode(e, ...TOUT);
  egal([s.ventes, s.encaisse, s.benefice], [50000, 0, 20000]);
  egal(m.totalARecevoir(e).CDF, 50000);
});

test('Client avec 2 dettes : le paiement va d’abord à la plus ancienne', () => {
  const { e, robe } = boutique();
  const v1 = vendre(e, robe, 1, 50000, { paiement: { type: 'credit', client: { nom: 'Neema' } } }, J('2026-11-01'));
  vendre(e, robe, 1, 50000, { paiement: { type: 'credit', client: { nom: 'neema ' } } }, J('2026-11-05'));
  egal(e.clients.length, 1, 'même cliente retrouvée par son nom');
  m.encaisserPaiement(e, { client_id: v1.client_id, devise_dette: 'CDF', montant_recu: 60000 }, J('2026-11-06'));
  const [ancienne, recente] = e.dettes.slice().sort((a, b) => a.cree_le.localeCompare(b.cree_le));
  egal(m.resteDette(e, ancienne), 0, 'ancienne soldée');
  egal(m.resteDette(e, recente), 40000, 'récente partiellement payée');
});

test('Dette en dollars payée en francs au taux du jour', () => {
  const { e, jean } = boutique('USD');
  const v = vendre(e, jean, 1, 2000, { devise: 'USD', paiement: { type: 'credit', client: { nom: 'Patrick' } } });
  refuse(() => m.encaisserPaiement(e, { client_id: v.client_id, devise_dette: 'USD', montant_recu: 57001, devise_recue: 'CDF' }), 'dépasse');
  const r = m.encaisserPaiement(e, { client_id: v.client_id, devise_dette: 'USD', montant_recu: 57000, devise_recue: 'CDF' }).resultat;
  egal(r.reste_apres, 0);
  egal(solde(e).CDF, 57000);
});

test('Annuler une vente à crédit déjà payée en partie est refusé', () => {
  const { e, robe } = boutique();
  const v = vendre(e, robe, 1, 50000, { paiement: { type: 'credit', client: { nom: 'Espoir' } } });
  m.encaisserPaiement(e, { client_id: v.client_id, devise_dette: 'CDF', montant_recu: 1000 });
  refuse(() => m.annulerVente(e, v.id), 'paiements');
});

test('Acompte égal au prix de vente refusé', () => {
  const { e, robe } = boutique();
  refuse(() => vendre(e, robe, 1, 50000, {
    paiement: { type: 'credit', client: { nom: 'X' }, acompte: { devise: 'CDF', montant: 50000 } },
  }), 'Payé');
});

/* ---------- Dépenses, caisse et bénéfice ---------- */

test('Dépense : sort de la caisse, modification et annulation corrigent la caisse', () => {
  const { e, robe } = boutique();
  vendre(e, robe, 2, 100000);
  const d = m.ajouterDepense(e, { montant: 30000, devise: 'CDF', type: 'loyer' }).resultat;
  egal(solde(e).CDF, 70000);
  m.modifierDepense(e, d.id, { montant: 20000 });
  egal(solde(e).CDF, 80000);
  m.annulerDepense(e, d.id);
  egal(solde(e).CDF, 100000);
  refuse(() => m.ajouterDepense(e, { montant: 1000, devise: 'CDF', type: 'inconnu' }));
});

test('Bénéfice = ventes − prix d’achat − dépenses (achats de marchandise non comptés deux fois)', () => {
  const { e, robe } = boutique();
  vendre(e, robe, 1, 50000);
  vendre(e, robe, 1, 50000, { paiement: { type: 'credit', client: { nom: 'K' }, acompte: { devise: 'CDF', montant: 5000 } } });
  m.ajouterDepense(e, { montant: 12000, devise: 'CDF', type: 'transport' });
  m.ajouterDepense(e, { montant: 90000, devise: 'CDF', type: 'marchandise' });
  const s = m.statsPeriode(e, ...TOUT);
  egal(s.ventes, 100000);
  egal(s.cout, 60000);
  egal(s.encaisse, 55000);
  egal(s.depenses, 102000, 'toutes les sorties de caisse');
  egal(s.depensesExploitation, 12000);
  egal(s.benefice, 28000);
  egal(solde(e).CDF, 55000 - 102000);
  const journal = m.journalCaisse(e, ...TOUT);
  const calc = journal.filter((x) => !x.annule_le).reduce((t, x) => t + (x.type === 'entree' ? 1 : -1) * x.montant, 0);
  egal(calc, solde(e).CDF, 'journal cohérent avec le solde');
});

/* ---------- Rapports journaliers ---------- */

test('Rapports : paiement reçu 5 jours après la vente, dans le rapport du jour du paiement', () => {
  const { e, robe } = boutique();
  vendre(e, robe, 1, 50000, {}, J('2026-11-01', 9));
  const v = vendre(e, robe, 1, 50000, { paiement: { type: 'credit', client: { nom: 'Jean' } } }, J('2026-11-01', 15));
  m.encaisserPaiement(e, { client_id: v.client_id, devise_dette: 'CDF', montant_recu: 20000 }, J('2026-11-06', 10));
  const r1 = m.rapportDuJour(e, '2026-11-01');
  const r6 = m.rapportDuJour(e, '2026-11-06');
  egal(r1.stats.ventes, 100000);
  egal(r1.stats.benefice, 40000);
  egal(r1.stats.encaisse, 50000);
  egal(r1.nouvellesDettes.length, 1);
  egal(r6.paiements[0].reste_apres, 30000);
  egal(r6.stats.encaisse, 20000);
  egal(r6.soldeDebut.CDF, 50000);
  egal(r6.soldeFin.CDF, 70000);
  egal(m.activiteParJour(e).get('2026-11-01').benefice, 40000, 'bénéfice dans la liste des jours');
});

test('Rapports : vente annulée visible mais hors totaux', () => {
  const { e, robe } = boutique();
  const v = vendre(e, robe, 1, 50000, {}, J('2026-11-02', 10));
  vendre(e, robe, 1, 45000, {}, J('2026-11-02', 11));
  m.annulerVente(e, v.id, J('2026-11-02', 12));
  const r = m.rapportDuJour(e, '2026-11-02');
  egal(r.ventes.length, 2, 'annulée toujours visible');
  egal(r.stats.ventes, 45000);
  egal(r.articlesVendus, [{ nom: 'Robe', quantite: 1 }]);
});

test('Rapports : totaux de chaque jour égaux au journal de caisse', () => {
  const { e, robe } = boutique();
  for (let i = 0; i < 4; i++) {
    vendre(e, robe, 1, 45000, {}, J(ajouterJours('2026-11-10', i)));
    m.ajouterDepense(e, { montant: 1000 * (i + 1), devise: 'CDF', type: 'transport' }, J(ajouterJours('2026-11-10', i), 13));
  }
  for (let i = 0; i < 4; i++) {
    const cle = ajouterJours('2026-11-10', i);
    const r = m.rapportDuJour(e, cle);
    const j = m.journalCaisse(e, cle, cle).filter((x) => !x.annule_le);
    egal(r.stats.encaisse, j.filter((x) => x.type === 'entree').reduce((s, x) => s + x.montant_principal, 0));
    egal(r.stats.depenses, j.filter((x) => x.type === 'sortie').reduce((s, x) => s + x.montant_principal, 0));
  }
});

test('Un paiement ne règle jamais une dette créée après lui (même jour)', () => {
  const { e, robe } = boutique();
  const v1 = vendre(e, robe, 1, 40000, { paiement: { type: 'credit', client: { nom: 'Aline' } } }, J('2026-11-10', 10));
  vendre(e, robe, 1, 50000, { paiement: { type: 'credit', client: { nom: 'Aline' } } }, J('2026-11-15', 16));
  // À 11 h le 15, seule la dette du 10 (40 000) existe : payer 45 000 est refusé
  refuse(() => m.encaisserPaiement(e, { client_id: v1.client_id, devise_dette: 'CDF', montant_recu: 45000 }, J('2026-11-15', 11)), 'dépasse');
  const r = m.encaisserPaiement(e, { client_id: v1.client_id, devise_dette: 'CDF', montant_recu: 40000 }, J('2026-11-15', 11)).resultat;
  egal(r.reste_apres, 0, 'reste après le paiement de 11 h');
  const rap = m.rapportDuJour(e, '2026-11-15');
  egal(rap.paiements[0].reste_apres, 0, 'jamais négatif dans le rapport');
});

test('Rapport du jour : ventes = payé + acomptes + dettes ; encaissé = payé + acomptes + remboursements', () => {
  const { e, robe, jean } = boutique('USD');
  const c = vendre(e, jean, 1, 2000, { devise: 'USD', paiement: { type: 'credit', client: { nom: 'Neema' } } }, J('2026-11-01'));
  vendre(e, robe, 1, 1500, { devise: 'USD' }, J('2026-11-05', 9));                                                    // payée
  vendre(e, jean, 1, 2500, { devise: 'USD', paiement: { type: 'credit', client: { nom: 'Ciza' },
    acompte: { devise: 'CDF', montant: 10001, mode: 'cash' } } }, J('2026-11-05', 10));                               // acompte en FC (arrondi)
  m.creerVente(e, { devise: 'USD', lignes: [{ article_id: robe.id, quantite: 1, montants: { USD: 700, CDF: 14251 } }],
    paiement: { type: 'credit', client: { nom: 'Bahati' }, acompte: { devise: 'CDF', montant: 5000 } } }, J('2026-11-05', 11)); // $ + FC
  m.encaisserPaiement(e, { client_id: c.client_id, devise_dette: 'USD', montant_recu: 2850, devise_recue: 'CDF' }, J('2026-11-05', 12)); // ancienne dette
  const r = m.rapportDuJour(e, '2026-11-05');
  const rp = r.repartition;
  egal(rp.comptant + rp.acomptes + rp.enDette, r.stats.ventes, 'ventes');
  egal(rp.comptant + rp.acomptes + rp.remboursements, r.stats.encaisse, 'encaissé');
  egal(rp.remboursements, 100, 'remboursement 2 850 FC = 1 $');
  if (rp.enDette <= 0) throw new Error('dettes du jour attendues');
});

test('Saisies invalides refusées', () => {
  const { e, robe } = boutique();
  refuse(() => m.ajouterArticle(e, { nom: '  ', prix_achat: 100, devise: 'CDF', quantite: 1 }), 'obligatoire');
  refuse(() => m.ajouterArticle(e, { nom: 'A', prix_achat: -5, devise: 'CDF', quantite: 1 }));
  refuse(() => m.ajouterArticle(e, { nom: 'A', prix_achat: 1.5, devise: 'CDF', quantite: 1 }));
  refuse(() => m.ajouterArticle(e, { nom: 'A', prix_achat: 100, devise: 'EUR', quantite: 1 }));
  refuse(() => vendre(e, robe, 0, 1000));
  refuse(() => m.creerVente(e, { lignes: [] }), 'vide');
});

test('Exemples de démonstration cohérents (stock, caisse, dettes, bénéfice)', () => {
  for (const devise of ['USD', 'CDF']) {
    const e = m.etatVide();
    m.creerProfil(e, { nom_boutique: 'Démo', devise_principale: devise, taux: 2850 });
    genererExemples(e);
    if (e.ventes.length < 40) throw new Error('trop peu de ventes : ' + e.ventes.length);
    if (e.articles.some((a) => a.quantite < 0)) throw new Error('stock négatif');
    const s = m.statsPeriode(e, ...TOUT);
    egal(e.lignes_de_vente.reduce((t, l) => t + l.montant_principal, 0), e.ventes.reduce((t, v) => t + v.total_principal, 0), `lignes = ventes (${devise})`);
    if (s.marge <= 0) throw new Error('marge des exemples non positive');
    for (const c of m.dettesParClient(e)) if (c.reste.USD < 0 || c.reste.CDF < 0) throw new Error('reste négatif');
    // Chaque jour : reste après paiement jamais négatif, ventes et encaissé décomposés exactement
    for (const cle of new Set(e.ventes.map((v) => cleJour(v.cree_le)))) {
      const r = m.rapportDuJour(e, cle);
      if (r.paiements.some((x) => x.reste_apres < 0)) throw new Error(`reste négatif dans le rapport du ${cle}`);
      const rp = r.repartition;
      egal(rp.comptant + rp.acomptes + rp.enDette, r.stats.ventes, `ventes du ${cle}`);
      egal(rp.comptant + rp.acomptes + rp.remboursements, r.stats.encaisse, `encaissé du ${cle}`);
    }
  }
});

/* ---------- Bilan ---------- */
const bilan = document.getElementById('bilan');
bilan.textContent = rates ? `ECHEC : ${rates} test(s) raté(s), ${reussis} réussi(s)` : `OK : ${reussis} tests réussis`;
bilan.className = rates ? 'ko' : 'ok';
document.title = bilan.textContent;
