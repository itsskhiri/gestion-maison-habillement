// Tests automatiques du moteur métier (ouvrir tests/index.html via un serveur local).
// Ils reprennent les scénarios obligatoires du cahier des charges.

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

// Boutique en francs, taux 2 850, avec deux articles.
function boutique(devise = 'CDF') {
  const e = m.etatVide();
  m.creerProfil(e, { nom_boutique: 'Boutique Test', devise_principale: devise, taux: 2850 });
  const robe = m.ajouterArticle(e, { nom: 'Robe', prix: 50000, devise: 'CDF', quantite: 5, categorie: 'robes' }).resultat;
  const jean = m.ajouterArticle(e, { nom: 'Jean', prix: 2000, devise: 'USD', quantite: 2, categorie: 'pantalons' }).resultat;
  return { e, robe, jean };
}
const solde = (e) => m.soldeCaisse(e);

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
  egal(convertir(30000, 'CDF', 'USD', 2850), 1053); // 10,526… $ -> 10,53 $
  egal(convertir(1001, 'USD', 'CDF', 2850), 28529); // 28 528,5 -> 28 529
  egal(divArrondi(5, 2), 3);
  egal(divArrondi(-5, 2), -3);
  // 0,1 + 0,2 en centimes reste exact
  egal(lireMontant('0,1', 'USD') + lireMontant('0,2', 'USD'), 30);
});

test('Fuseau : une vente à 23 h 30 à Bukavu compte bien pour ce jour-là', () => {
  const iso = isoPourJour('2026-11-10', 23, 30);
  egal(iso, '2026-11-10T21:30:00.000Z');
  egal(cleJour(iso), '2026-11-10');
  egal(cleJour('2026-11-10T22:30:00.000Z'), '2026-11-11');
});

/* ---------- Ventes et stock ---------- */

test('Vente payée : stock baisse, caisse augmente, prix figé dans la ligne', () => {
  const { e, robe } = boutique();
  const v = m.creerVente(e, { lignes: [{ article_id: robe.id, quantite: 2 }] }).resultat;
  egal(v.total, 100000);
  egal(robe.quantite, 3);
  egal(solde(e).CDF, 100000);
  m.modifierArticle(e, robe.id, { prix: 70000 });
  const lg = e.lignes_de_vente.find((l) => l.vente_id === v.id);
  egal(lg.prix_unitaire, 50000, 'prix historique');
  egal(lg.nom, 'Robe');
});

test('Vente : article en dollars vendu en francs au taux du jour', () => {
  const { e, jean } = boutique();
  const v = m.creerVente(e, { devise: 'CDF', lignes: [{ article_id: jean.id, quantite: 1 }] }).resultat;
  egal(v.total, 57000);
  egal(v.taux, 2850);
});

test('Vente : paiement mixte dollars + francs', () => {
  const { e, robe } = boutique();
  // Total 100 000 FC : le client donne 20 $ (57 000 FC) + 43 000 FC
  m.creerVente(e, {
    lignes: [{ article_id: robe.id, quantite: 2 }],
    paiement: { type: 'payee', encaissements: [{ devise: 'USD', montant: 2000, mode: 'cash' }, { devise: 'CDF', montant: 43000, mode: 'mpesa' }] },
  });
  egal(solde(e).USD, 2000);
  egal(solde(e).CDF, 43000);
  egal(solde(e).modes.mpesa.CDF, 43000);
  egal(m.statsPeriode(e, '0000-01-01', '9999-12-31').encaisse, 100000, 'encaissé = total exact');
  refuse(() => m.creerVente(e, {
    lignes: [{ article_id: robe.id, quantite: 1 }],
    paiement: { type: 'payee', encaissements: [{ devise: 'CDF', montant: 10000, mode: 'cash' }] },
  }), 'ne correspond pas');
});

test('Paiement mixte : francs saisis d’abord, dollars complétés (arrondi au centime accepté)', () => {
  const { e, robe } = boutique();
  // Total 100 000 FC ; le client donne 40 000 FC, le reste 60 000 FC = 21,05 $ (arrondi)
  const u = convertir(60000, 'CDF', 'USD', 2850);
  egal(u, 2105);
  m.creerVente(e, {
    lignes: [{ article_id: robe.id, quantite: 2 }],
    paiement: { type: 'payee', encaissements: [{ devise: 'USD', montant: u, mode: 'cash' }, { devise: 'CDF', montant: 40000, mode: 'cash' }] },
  });
  egal(solde(e).USD, 2105);
  egal(solde(e).CDF, 40000);
  egal(m.statsPeriode(e, '0000-01-01', '9999-12-31').encaisse, 100000, 'encaissé = total exact');
  // Mais un écart réel (1 $ de moins) est refusé
  refuse(() => m.creerVente(e, {
    lignes: [{ article_id: robe.id, quantite: 1 }],
    paiement: { type: 'payee', encaissements: [{ devise: 'USD', montant: 1000, mode: 'cash' }, { devise: 'CDF', montant: 20000, mode: 'cash' }] },
  }), 'ne correspond pas');
});

test('Stock jamais négatif', () => {
  const { e, jean } = boutique();
  refuse(() => m.creerVente(e, { lignes: [{ article_id: jean.id, quantite: 3 }] }), 'Stock insuffisant');
  refuse(() => m.creerVente(e, { lignes: [{ article_id: jean.id, quantite: 2 }, { article_id: jean.id, quantite: 1 }] }), 'Stock insuffisant');
  m.creerVente(e, { lignes: [{ article_id: jean.id, quantite: 2 }] });
  egal(jean.quantite, 0, 'stock à zéro');
  refuse(() => m.creerVente(e, { lignes: [{ article_id: jean.id, quantite: 1 }] }));
  refuse(() => m.ajusterStock(e, jean.id, -1), 'négatif');
  m.ajusterStock(e, jean.id, 4);
  egal(jean.quantite, 4, 'nouvel arrivage');
});

test('Une vente refusée ne modifie rien (tout ou rien)', () => {
  const { e, robe, jean } = boutique();
  const avant = JSON.stringify(e);
  refuse(() => m.creerVente(e, { lignes: [{ article_id: robe.id, quantite: 1 }, { article_id: jean.id, quantite: 9 }] }));
  egal(JSON.stringify(e), avant);
});

test('Annulation de vente : stock rendu, caisse corrigée, trace conservée', () => {
  const { e, robe } = boutique();
  const v = m.creerVente(e, { lignes: [{ article_id: robe.id, quantite: 1 }] }).resultat;
  m.annulerVente(e, v.id);
  egal(robe.quantite, 5);
  egal(solde(e).CDF, 0);
  egal(e.ventes.length, 1, 'la vente reste dans l’historique');
  egal(m.statsPeriode(e, '0000-01-01', '9999-12-31').ventes, 0);
});

test('Même identifiant envoyé deux fois : une seule vente (pas de doublon)', () => {
  const { e, robe } = boutique();
  const id = m.uuid();
  m.creerVente(e, { id, lignes: [{ article_id: robe.id, quantite: 1 }] });
  m.creerVente(e, { id, lignes: [{ article_id: robe.id, quantite: 1 }] });
  egal(e.ventes.length, 1);
  egal(robe.quantite, 4);
});

/* ---------- Dettes (scénario obligatoire) ---------- */

test('Dette 50 000 + acompte 10 000 -> paiements 15 000 puis 25 000', () => {
  const e = m.etatVide();
  m.creerProfil(e, { nom_boutique: 'B', devise_principale: 'CDF', taux: 2850 });
  const a = m.ajouterArticle(e, { nom: 'Robe', prix: 50000, devise: 'CDF', quantite: 3 }).resultat;
  const v = m.creerVente(e, {
    lignes: [{ article_id: a.id, quantite: 1 }],
    paiement: { type: 'credit', client: { nom: 'Furaha' }, acompte: { devise: 'CDF', montant: 10000, mode: 'cash' } },
  }).resultat;
  const cid = v.client_id;
  egal(solde(e).CDF, 10000, 'caisse après acompte');
  egal(m.ficheClient(e, cid).reste.CDF, 40000, 'reste après acompte');

  let r = m.encaisserPaiement(e, { client_id: cid, devise_dette: 'CDF', montant_recu: 15000 }).resultat;
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
  egal(m.ficheClient(e, cid).soldee, false);
});

test('Vente à crédit : n’entre pas dans la caisse, mais compte dans les ventes', () => {
  const { e, robe } = boutique();
  m.creerVente(e, { lignes: [{ article_id: robe.id, quantite: 1 }], paiement: { type: 'credit', client: { nom: 'Aline' } } });
  egal(solde(e).CDF, 0);
  const s = m.statsPeriode(e, '0000-01-01', '9999-12-31');
  egal(s.ventes, 50000);
  egal(s.encaisse, 0);
  egal(m.totalARecevoir(e).CDF, 50000);
});

test('Client avec 2 dettes : le paiement va d’abord à la plus ancienne', () => {
  const { e, robe } = boutique();
  const v1 = m.creerVente(e, { lignes: [{ article_id: robe.id, quantite: 1 }], paiement: { type: 'credit', client: { nom: 'Neema' } } }, J('2026-11-01')).resultat;
  m.creerVente(e, { lignes: [{ article_id: robe.id, quantite: 1 }], paiement: { type: 'credit', client: { nom: 'neema ' } } }, J('2026-11-05'));
  egal(e.clients.length, 1, 'même cliente retrouvée par son nom');
  m.encaisserPaiement(e, { client_id: v1.client_id, devise_dette: 'CDF', montant_recu: 60000 }, J('2026-11-06'));
  const [ancienne, recente] = e.dettes.slice().sort((a, b) => a.cree_le.localeCompare(b.cree_le));
  egal(m.resteDette(e, ancienne), 0, 'ancienne soldée');
  egal(m.resteDette(e, recente), 40000, 'récente partiellement payée');
});

test('Dette en dollars payée en francs au taux du jour', () => {
  const { e, jean } = boutique('USD');
  const v = m.creerVente(e, { devise: 'USD', lignes: [{ article_id: jean.id, quantite: 1 }], paiement: { type: 'credit', client: { nom: 'Patrick' } } }).resultat;
  // reste 20 $ = 57 000 FC
  refuse(() => m.encaisserPaiement(e, { client_id: v.client_id, devise_dette: 'USD', montant_recu: 57001, devise_recue: 'CDF' }), 'dépasse');
  const r = m.encaisserPaiement(e, { client_id: v.client_id, devise_dette: 'USD', montant_recu: 57000, devise_recue: 'CDF' }).resultat;
  egal(r.reste_apres, 0);
  egal(solde(e).CDF, 57000, 'francs entrés dans la caisse');
});

test('Annuler une vente à crédit déjà payée en partie est refusé', () => {
  const { e, robe } = boutique();
  const v = m.creerVente(e, { lignes: [{ article_id: robe.id, quantite: 1 }], paiement: { type: 'credit', client: { nom: 'Espoir' } } }).resultat;
  m.encaisserPaiement(e, { client_id: v.client_id, devise_dette: 'CDF', montant_recu: 1000 });
  refuse(() => m.annulerVente(e, v.id), 'paiements');
});

test('Acompte égal au total refusé', () => {
  const { e, robe } = boutique();
  refuse(() => m.creerVente(e, {
    lignes: [{ article_id: robe.id, quantite: 1 }],
    paiement: { type: 'credit', client: { nom: 'X' }, acompte: { devise: 'CDF', montant: 50000 } },
  }), 'Payé');
});

/* ---------- Dépenses et caisse ---------- */

test('Dépense : sort de la caisse, modification et annulation corrigent la caisse', () => {
  const { e, robe } = boutique();
  m.creerVente(e, { lignes: [{ article_id: robe.id, quantite: 2 }] });
  const d = m.ajouterDepense(e, { montant: 30000, devise: 'CDF', type: 'loyer' }).resultat;
  egal(solde(e).CDF, 70000);
  m.modifierDepense(e, d.id, { montant: 20000 });
  egal(solde(e).CDF, 80000);
  m.annulerDepense(e, d.id);
  egal(solde(e).CDF, 100000);
  refuse(() => m.ajouterDepense(e, { montant: 1000, devise: 'CDF', type: 'inconnu' }));
});

test('Caisse = entrées − sorties, et bénéfice = ventes − dépenses', () => {
  const { e, robe } = boutique();
  m.creerVente(e, { lignes: [{ article_id: robe.id, quantite: 1 }] });
  m.creerVente(e, { lignes: [{ article_id: robe.id, quantite: 1 }], paiement: { type: 'credit', client: { nom: 'K' }, acompte: { devise: 'CDF', montant: 5000 } } });
  m.ajouterDepense(e, { montant: 12000, devise: 'CDF', type: 'transport' });
  const s = m.statsPeriode(e, '0000-01-01', '9999-12-31');
  egal(s.ventes, 100000);
  egal(s.encaisse, 55000);
  egal(s.depenses, 12000);
  egal(s.benefice, 88000);
  egal(solde(e).CDF, 43000);
  const journal = m.journalCaisse(e, '0000-01-01', '9999-12-31');
  const calc = journal.filter((x) => !x.annule_le).reduce((t, x) => t + (x.type === 'entree' ? 1 : -1) * x.montant, 0);
  egal(calc, solde(e).CDF, 'journal cohérent avec le solde');
});

/* ---------- Rapports journaliers ---------- */

test('Rapports : paiement reçu 5 jours après la vente, dans le rapport du jour du paiement', () => {
  const { e, robe } = boutique();
  m.creerVente(e, { lignes: [{ article_id: robe.id, quantite: 1 }] }, J('2026-11-01', 9));
  const v = m.creerVente(e, { lignes: [{ article_id: robe.id, quantite: 1 }], paiement: { type: 'credit', client: { nom: 'Jean' } } }, J('2026-11-01', 15)).resultat;
  m.encaisserPaiement(e, { client_id: v.client_id, devise_dette: 'CDF', montant_recu: 20000 }, J('2026-11-06', 10));
  const r1 = m.rapportDuJour(e, '2026-11-01');
  const r6 = m.rapportDuJour(e, '2026-11-06');
  egal(r1.stats.ventes, 100000);
  egal(r1.stats.encaisse, 50000);
  egal(r1.nouvellesDettes.length, 1);
  egal(r1.paiements.length, 0);
  egal(r6.paiements.length, 1);
  egal(r6.paiements[0].reste_apres, 30000);
  egal(r6.stats.encaisse, 20000);
  egal(r6.soldeDebut.CDF, 50000, 'solde début du 6');
  egal(r6.soldeFin.CDF, 70000, 'solde fin du 6');
});

test('Rapports : vente annulée visible mais hors totaux ; changement de prix sans effet', () => {
  const { e, robe } = boutique();
  const v = m.creerVente(e, { lignes: [{ article_id: robe.id, quantite: 1 }] }, J('2026-11-02', 10)).resultat;
  m.creerVente(e, { lignes: [{ article_id: robe.id, quantite: 1 }] }, J('2026-11-02', 11));
  m.annulerVente(e, v.id, J('2026-11-02', 12));
  m.modifierArticle(e, robe.id, { prix: 99000 });
  const r = m.rapportDuJour(e, '2026-11-02');
  egal(r.ventes.length, 2, 'annulée toujours visible');
  egal(r.stats.ventes, 50000);
  egal(r.articlesVendus, [{ nom: 'Robe', quantite: 1 }]);
  egal(r.ventes[1].lignes[0].prix_unitaire, 50000);
});

test('Rapports : totaux de chaque jour égaux au journal de caisse', () => {
  const { e, robe } = boutique();
  for (let i = 0; i < 4; i++) {
    m.creerVente(e, { lignes: [{ article_id: robe.id, quantite: 1 }] }, J(ajouterJours('2026-11-10', i)));
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

test('Ventes par catégorie et meilleures ventes', () => {
  const { e, robe, jean } = boutique();
  m.creerVente(e, { lignes: [{ article_id: robe.id, quantite: 2 }, { article_id: jean.id, quantite: 1 }] });
  const cats = m.ventesParCategorie(e, '0000-01-01', '9999-12-31');
  egal(cats.map((c) => [c.id, c.valeur]), [['robes', 100000], ['pantalons', 57000]]);
  egal(m.meilleuresVentes(e, '0000-01-01', '9999-12-31')[0].nom, 'Robe');
});

test('Saisies invalides refusées', () => {
  const { e, robe } = boutique();
  refuse(() => m.ajouterArticle(e, { nom: '  ', prix: 100, devise: 'CDF', quantite: 1 }), 'obligatoire');
  refuse(() => m.ajouterArticle(e, { nom: 'A', prix: -5, devise: 'CDF', quantite: 1 }));
  refuse(() => m.ajouterArticle(e, { nom: 'A', prix: 1.5, devise: 'CDF', quantite: 1 }));
  refuse(() => m.ajouterArticle(e, { nom: 'A', prix: 100, devise: 'EUR', quantite: 1 }));
  refuse(() => m.creerVente(e, { lignes: [{ article_id: robe.id, quantite: 0 }] }));
  refuse(() => m.creerVente(e, { lignes: [] }), 'vide');
});

test('Exemples de démonstration cohérents (stock, caisse, dettes)', () => {
  for (const devise of ['USD', 'CDF']) {
    const e = m.etatVide();
    m.creerProfil(e, { nom_boutique: 'Démo', devise_principale: devise, taux: 2850 });
    genererExemples(e);
    if (e.ventes.length < 60) throw new Error('trop peu de ventes : ' + e.ventes.length);
    if (e.articles.some((a) => a.quantite < 0)) throw new Error('stock négatif');
    const s = m.statsPeriode(e, '0000-01-01', '9999-12-31');
    const lignes = e.lignes_de_vente.reduce((t, l) => t + l.montant_principal, 0);
    const ventes = e.ventes.reduce((t, v) => t + v.total_principal, 0);
    egal(lignes, ventes, `lignes = ventes (${devise})`);
    egal(s.ventes, ventes);
    for (const c of m.dettesParClient(e)) {
      if (c.reste.USD < 0 || c.reste.CDF < 0) throw new Error('reste négatif');
    }
    if (!e.paiements_dette.length) throw new Error('aucun paiement de dette');
    if (!e.dettes.some((d) => m.resteDette(e, d) > 0)) throw new Error('aucune dette en cours');
  }
});

/* ---------- Bilan ---------- */
const bilan = document.getElementById('bilan');
bilan.textContent = rates ? `ECHEC : ${rates} test(s) raté(s), ${reussis} réussi(s)` : `OK : ${reussis} tests réussis`;
bilan.className = rates ? 'ko' : 'ok';
document.title = bilan.textContent;
