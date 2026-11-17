// Moteur métier : toutes les règles de la boutique (vente, stock, caisse, dettes, dépenses).
//
// Chaque opération qui écrit :
//   1. vérifie TOUT avant de modifier quoi que ce soit (si une règle échoue, rien n'est changé) ;
//   2. applique ses changements et renvoie { changes, resultat }, où `changes` liste les
//      enregistrements touchés par table : la couche api.js les écrit dans UNE transaction.
// Cette logique est la même que celle des fonctions SQL PostgreSQL de l'étape 2.

import { convertir, formater, toleranceConversion, DEVISES } from './money.js';
import { cleJour, heureNumero, maintenantIso } from './temps.js';
import { CATEGORIES, TYPES_DEPENSE, MODES, categorie as infoCategorie, typeDepense } from './reference.js';

export class ErreurMetier extends Error {
  constructor(message) { super(message); this.name = 'ErreurMetier'; }
}
const echec = (message) => { throw new ErreurMetier(message); };

export const TABLES = [
  'profil', 'articles', 'clients', 'ventes', 'lignes_de_vente', 'dettes',
  'paiements_dette', 'imputations', 'depenses', 'mouvements_caisse',
];

export function etatVide() {
  const e = { profil: null };
  for (const t of TABLES) if (t !== 'profil') e[t] = [];
  return e;
}

export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const x = [...b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/* ---------- Outils internes ---------- */

const MAX_MONTANT = 1e12;
const date = (opts) => opts?.date ?? maintenantIso();
const normaliser = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function lot(etat) {
  const changes = {};
  const noter = (table, rec) => {
    const liste = (changes[table] ??= []);
    if (!liste.includes(rec)) liste.push(rec);
  };
  return {
    changes,
    inserer(table, rec) { etat[table].push(rec); noter(table, rec); },
    maj: noter,
    profil(rec) { etat.profil = rec; changes.profil = [rec]; },
  };
}

const rien = (resultat) => ({ changes: {}, resultat });

function texte(v, champ, max = 80) {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!t) echec(`${champ} est obligatoire.`);
  if (t.length > max) echec(`${champ} est trop long (${max} caractères maximum).`);
  return t;
}
function texteFacultatif(v, champ, max) {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length > max) echec(`${champ} est trop long (${max} caractères maximum).`);
  return t;
}
function entier(v, champ, min = 0, max = MAX_MONTANT) {
  if (!Number.isInteger(v) || v < min || v > max) echec(`${champ} n'est pas valide.`);
  return v;
}
function verifDevise(d) { if (!DEVISES[d]) echec('Devise inconnue.'); return d; }
function verifMode(m) { if (!MODES.some((x) => x.id === m)) echec('Mode de paiement inconnu.'); return m; }
function verifCategorie(c) {
  if (c == null || c === '') return null;
  if (!CATEGORIES.some((x) => x.id === c)) echec('Catégorie inconnue.');
  return c;
}
function verifTaux(t) { return entier(t, 'Le taux', 1, 1000000); }

function trouver(liste, id, message) {
  const x = liste.find((r) => r.id === id);
  if (!x) echec(message);
  return x;
}

export function exigerProfil(etat) {
  if (!etat.profil) echec("La boutique n'est pas encore créée.");
  return etat.profil;
}

// Prix d'achat d'une pièce exprimé dans une devise de vente (arrondi au plus proche).
export function prixAchatEn(article, devise, taux) {
  return convertir(article.prix_achat, article.devise, devise, taux);
}

// Ajuste le dernier montant pour que la somme soit exactement `total` (écarts d'arrondi).
function repartir(montants, total) {
  const r = montants.slice();
  r[r.length - 1] += total - r.reduce((a, b) => a + b, 0);
  return r;
}

function mouvement({ type, source, reference_id, devise, montant, mode, montant_principal, quand }) {
  return {
    id: uuid(), type, source, reference_id, devise, montant, mode,
    montant_principal, cree_le: quand, annule_le: null,
  };
}

/* ---------- Profil de la boutique ---------- */

export function creerProfil(etat, entree, opts) {
  if (etat.profil) echec('La boutique existe déjà.');
  const quand = date(opts);
  const p = {
    id: 'profil',
    nom_boutique: texte(entree.nom_boutique, 'Le nom de la boutique', 60),
    devise_principale: verifDevise(entree.devise_principale),
    taux: verifTaux(entree.taux),
    fuseau: entree.fuseau || 'Africa/Lubumbashi',
    seuil_stock_bas: entier(entree.seuil_stock_bas ?? 3, 'Le seuil de stock bas', 0, 1000),
    cree_le: quand,
    modifie_le: quand,
  };
  const l = lot(etat);
  l.profil(p);
  return { changes: l.changes, resultat: p };
}

const aDesOperations = (etat) =>
  etat.ventes.length || etat.depenses.length || etat.paiements_dette.length;

export function modifierProfil(etat, champs, opts) {
  const p = exigerProfil(etat);
  const n = {};
  if ('nom_boutique' in champs) n.nom_boutique = texte(champs.nom_boutique, 'Le nom de la boutique', 60);
  if ('devise_principale' in champs && champs.devise_principale !== p.devise_principale) {
    if (aDesOperations(etat)) echec('La devise principale ne peut plus changer : des opérations existent déjà.');
    n.devise_principale = verifDevise(champs.devise_principale);
  }
  if ('taux' in champs) n.taux = verifTaux(champs.taux);
  if ('seuil_stock_bas' in champs) n.seuil_stock_bas = entier(champs.seuil_stock_bas, 'Le seuil de stock bas', 0, 1000);
  if ('fuseau' in champs) {
    try { new Intl.DateTimeFormat('fr', { timeZone: champs.fuseau }); } catch { echec('Fuseau horaire inconnu.'); }
    n.fuseau = champs.fuseau;
  }
  Object.assign(p, n, { modifie_le: date(opts) });
  const l = lot(etat);
  l.profil(p);
  return { changes: l.changes, resultat: p };
}

/* ---------- Articles ---------- */

export const articlesActifs = (etat) => etat.articles.filter((a) => !a.supprime_le);

function champsArticle(entree, partiel = false) {
  const r = {};
  if (!partiel || 'nom' in entree) r.nom = texte(entree.nom, "Le nom de l'article", 80);
  if (!partiel || 'prix_achat' in entree) r.prix_achat = entier(entree.prix_achat, "Le prix d'achat", 1);
  if (!partiel || 'devise' in entree) r.devise = verifDevise(entree.devise);
  if (!partiel || 'quantite' in entree) r.quantite = entier(entree.quantite, 'La quantité', 0, 1000000);
  if (!partiel || 'categorie' in entree) r.categorie = verifCategorie(entree.categorie);
  return r;
}

export function ajouterArticle(etat, entree, opts) {
  exigerProfil(etat);
  const id = entree.id || uuid();
  const existe = etat.articles.find((a) => a.id === id);
  if (existe) return rien(existe);
  const quand = date(opts);
  const a = { id, ...champsArticle(entree), cree_le: quand, modifie_le: quand, supprime_le: null };
  const l = lot(etat);
  l.inserer('articles', a);
  return { changes: l.changes, resultat: a };
}

export function modifierArticle(etat, id, champs, opts) {
  const a = trouver(articlesActifs(etat), id, 'Article introuvable.');
  const n = champsArticle(champs, true);
  Object.assign(a, n, { modifie_le: date(opts) });
  const l = lot(etat);
  l.maj('articles', a);
  return { changes: l.changes, resultat: a };
}

// Nouvel arrivage (+) ou correction (−) du stock.
export function ajusterStock(etat, id, delta, opts) {
  const a = trouver(articlesActifs(etat), id, 'Article introuvable.');
  entier(Math.abs(delta), 'La quantité', 0, 1000000);
  if (a.quantite + delta < 0) echec(`Le stock ne peut pas être négatif (stock actuel : ${a.quantite}).`);
  a.quantite += delta;
  a.modifie_le = date(opts);
  const l = lot(etat);
  l.maj('articles', a);
  return { changes: l.changes, resultat: a };
}

// Suppression « douce » : l'historique des ventes garde le nom et le coût.
export function supprimerArticle(etat, id, opts) {
  const a = trouver(articlesActifs(etat), id, 'Article introuvable.');
  a.supprime_le = date(opts);
  a.modifie_le = a.supprime_le;
  const l = lot(etat);
  l.maj('articles', a);
  return { changes: l.changes, resultat: a };
}

/* ---------- Clients ---------- */

function resoudreClient(etat, c, quand) {
  if (!c || (!c.id && !c.nom)) echec('Choisis un client ou saisis son nom.');
  if (c.id) {
    const x = etat.clients.find((k) => k.id === c.id);
    if (x) return { client: x, nouveau: null };
    if (!c.nom) echec('Client introuvable.');
  }
  const nom = texte(c.nom, 'Le nom du client', 60);
  const deja = etat.clients.find((k) => normaliser(k.nom) === normaliser(nom));
  if (deja) return { client: deja, nouveau: null };
  const telephone = texteFacultatif(c.telephone, 'Le téléphone', 20);
  if (telephone && !/^[+0-9 ()-]{6,20}$/.test(telephone)) echec("Le numéro de téléphone n'est pas valide.");
  const client = { id: c.id || uuid(), nom, telephone, cree_le: quand };
  return { client, nouveau: client };
}

/* ---------- Ventes ---------- */

// Le prix d'un article est son PRIX D'ACHAT. Le prix de vente se discute avec le client :
// le vendeur saisit le prix de vente de CHAQUE produit au moment de valider. Une ligne vendue
// en dessous de son prix d'achat rend la vente invalide.
// entree = {
//   id?, devise?, taux?,
//   lignes: [{ article_id, quantite, prix_unitaire, devise? }]   prix d'une pièce, dans la devise de la
//           ligne (par défaut celle de la vente),
//        ou [{ article_id, quantite, montants: { USD, CDF } }]     vente « $ + FC » : ce que le client paie
//           pour cette ligne, une partie en dollars et une partie en francs (convertie au taux de la vente).
//   Une vente peut donc avoir un total en dollars ET un total en francs (`totaux`).
//   paiement: { type: 'payee', encaissements?: [{ devise, montant, mode }] }
//           | { type: 'credit', client: { id? | nom, telephone? }, acompte?: { devise, montant, mode } }
// }
export function creerVente(etat, entree, opts) {
  const p = exigerProfil(etat);
  const id = entree.id || uuid();
  const existe = etat.ventes.find((v) => v.id === id);
  if (existe) return rien(existe); // déjà enregistrée (renvoi de synchronisation)

  const devise = verifDevise(entree.devise ?? p.devise_principale);
  const taux = verifTaux(entree.taux ?? p.taux);
  const quand = date(opts);
  if (!Array.isArray(entree.lignes) || !entree.lignes.length) echec('Le panier est vide.');

  const besoin = new Map();
  const lignes = entree.lignes.map((lg) => {
    const a = articlesActifs(etat).find((x) => x.id === lg.article_id);
    if (!a) echec("Un article du panier n'existe plus.");
    const quantite = entier(lg.quantite, 'La quantité', 1, 100000);
    const cout = convertir(a.prix_achat * quantite, a.devise, p.devise_principale, taux);
    if (lg.montants) {
      // Paiement de la ligne en dollars + francs : la valeur totale (au taux de la vente) doit
      // couvrir le prix d'achat, comparée dans la devise du prix d'achat.
      const montants = {
        USD: entier(lg.montants.USD ?? 0, `Le montant en dollars de « ${a.nom} »`, 0),
        CDF: entier(lg.montants.CDF ?? 0, `Le montant en francs de « ${a.nom} »`, 0),
      };
      if (!montants.USD && !montants.CDF) echec(`Saisis ce que le client paie pour « ${a.nom} ».`);
      const valeur = convertir(montants.USD, 'USD', a.devise, taux) + convertir(montants.CDF, 'CDF', a.devise, taux);
      const achat = a.prix_achat * quantite;
      if (valeur < achat) {
        echec(`Vente invalide : « ${a.nom} » est vendu ${formater(valeur, a.devise)}, sous son prix d'achat (${formater(achat, a.devise)}).`);
      }
      besoin.set(a.id, (besoin.get(a.id) || 0) + quantite);
      return { a, quantite, montants, devise: 'mixte', cout };
    }
    if (lg.prix_unitaire == null || lg.prix_unitaire === '') echec(`Saisis le prix de vente de « ${a.nom} ».`);
    const prix = entier(lg.prix_unitaire, `Le prix de vente de « ${a.nom} »`, 1);
    const dl = verifDevise(lg.devise ?? devise);
    const achat = prixAchatEn(a, dl, taux);
    if (prix < achat) {
      echec(`Vente invalide : « ${a.nom} » est vendu ${formater(prix, dl)}, sous son prix d'achat (${formater(achat, dl)}).`);
    }
    besoin.set(a.id, (besoin.get(a.id) || 0) + quantite);
    // Coût d'achat de la ligne, dans la devise principale, au taux de la vente.
    return { a, quantite, prix, devise: dl, montants: { USD: 0, CDF: 0, [dl]: quantite * prix }, cout };
  });
  for (const [aid, q] of besoin) {
    const a = etat.articles.find((x) => x.id === aid);
    if (q > a.quantite) echec(`Stock insuffisant pour « ${a.nom} » (il en reste ${a.quantite}).`);
  }
  // Total par devise (« Total dollars » et « Total francs »), puis total dans la devise de la vente.
  const totaux = { USD: 0, CDF: 0 };
  for (const x of lignes) { totaux.USD += x.montants.USD; totaux.CDF += x.montants.CDF; }
  const devisesVendues = ['USD', 'CDF'].filter((d) => totaux[d] > 0);
  const total = devisesVendues.reduce((s, d) => s + convertir(totaux[d], d, devise, taux), 0);
  const total_principal = devisesVendues.reduce((s, d) => s + convertir(totaux[d], d, p.devise_principale, taux), 0);
  const cout_principal = lignes.reduce((s, x) => s + x.cout, 0);

  const pay = entree.paiement || { type: 'payee' };
  let encaissements = [];
  let client = null;
  let nouveauClient = null;
  let acompte = null;

  if (pay.type === 'payee') {
    // Par défaut : les dollars sont payés en dollars et les francs en francs.
    const brut = pay.encaissements?.length ? pay.encaissements
      : devisesVendues.map((d) => ({ devise: d, montant: totaux[d], mode: pay.mode || 'cash' }));
    encaissements = brut.map((e) => ({
      devise: verifDevise(e.devise),
      montant: entier(e.montant, 'Le montant reçu', 1),
      mode: verifMode(e.mode || 'cash'),
    }));
    const contreValeur = encaissements.reduce((s, e) => s + convertir(e.montant, e.devise, devise, taux), 0);
    // Marge d'arrondi des conversions (au plus un centime ou un franc par partie dans l'autre devise).
    const tolerance = encaissements.reduce((s, e) => s + toleranceConversion(e.devise, devise, taux), 0);
    if (Math.abs(contreValeur - total) > tolerance) echec('Le montant reçu ne correspond pas au total de la vente.');
  } else if (pay.type === 'credit') {
    ({ client, nouveau: nouveauClient } = resoudreClient(etat, pay.client, quand));
    if (pay.acompte && pay.acompte.montant) {
      acompte = {
        devise: verifDevise(pay.acompte.devise),
        montant: entier(pay.acompte.montant, "L'acompte", 1),
        mode: verifMode(pay.acompte.mode || 'cash'),
      };
      if (devisesVendues.length === 1) {
        // Vente dans une seule devise : l'acompte peut être donné dans l'autre devise (converti).
        acompte.parDevise = { [devisesVendues[0]]: convertir(acompte.montant, acompte.devise, devisesVendues[0], taux) };
        if (acompte.parDevise[devisesVendues[0]] >= totaux[devisesVendues[0]]) echec("L'acompte couvre tout le total : choisis plutôt « Payé ».");
      } else {
        // Vente $ + FC : l'acompte réduit la dette de sa propre devise.
        if (acompte.montant > totaux[acompte.devise]) {
          echec(`L'acompte dépasse le total en ${acompte.devise === 'USD' ? 'dollars' : 'francs'} (${formater(totaux[acompte.devise], acompte.devise)}).`);
        }
        acompte.parDevise = { [acompte.devise]: acompte.montant };
      }
    }
  } else {
    echec('Type de vente inconnu.');
  }

  // --- Tout est vérifié : on applique ---
  const l = lot(etat);
  if (nouveauClient) l.inserer('clients', nouveauClient);
  const vente = {
    id, numero: prochainNumero(etat), cree_le: quand, devise, taux, total, totaux, total_principal, cout_principal,
    statut: pay.type, client_id: client?.id ?? null,
    mode: pay.type === 'payee' ? encaissements[0].mode : acompte?.mode ?? null,
    annule_le: null,
  };
  l.inserer('ventes', vente);

  const principaux = repartir(
    lignes.map((x) => convertir(x.montants.USD, 'USD', p.devise_principale, taux) + convertir(x.montants.CDF, 'CDF', p.devise_principale, taux)),
    total_principal,
  );
  lignes.forEach((x, i) => l.inserer('lignes_de_vente', {
    id: uuid(), vente_id: id, article_id: x.a.id, nom: x.a.nom, categorie: x.a.categorie,
    quantite: x.quantite, prix_unitaire: x.prix ?? null, devise: x.devise, montants: x.montants,
    cout_principal: x.cout, montant_principal: principaux[i],
  }));

  for (const [aid, q] of besoin) {
    const a = etat.articles.find((x) => x.id === aid);
    a.quantite -= q;
    a.modifie_le = quand;
    l.maj('articles', a);
  }

  if (pay.type === 'payee') {
    const parts = repartir(
      encaissements.map((e) => convertir(e.montant, e.devise, p.devise_principale, taux)),
      total_principal,
    );
    encaissements.forEach((e, i) => l.inserer('mouvements_caisse', mouvement({
      type: 'entree', source: 'vente', reference_id: id, devise: e.devise, montant: e.montant,
      mode: e.mode, montant_principal: parts[i], quand,
    })));
  } else {
    // Une dette par devise vendue (une vente $ + FC à crédit donne une dette en $ et une en FC).
    for (const d of devisesVendues) {
      const avance = acompte?.parDevise[d] ?? 0;
      if (totaux[d] - avance <= 0) continue;
      l.inserer('dettes', {
        id: uuid(), client_id: client.id, vente_id: id, devise: d, taux,
        montant_vente: totaux[d], acompte: avance, montant: totaux[d] - avance,
        cree_le: quand, annule_le: null,
      });
    }
    if (acompte) {
      l.inserer('mouvements_caisse', mouvement({
        type: 'entree', source: 'acompte', reference_id: id, devise: acompte.devise,
        montant: acompte.montant, mode: acompte.mode,
        montant_principal: convertir(acompte.montant, acompte.devise, p.devise_principale, taux), quand,
      }));
    }
  }
  return { changes: l.changes, resultat: vente };
}

// Numéro de la prochaine facture (chaque vente est une facture : n° 1, 2, 3…).
function prochainNumero(etat) {
  let max = 0;
  for (const v of etat.ventes) if (v.numero > max) max = v.numero;
  return max + 1;
}

// Donne un numéro de facture aux ventes enregistrées avant la numérotation (par ordre de date).
export function numeroterVentes(etat) {
  const sans = etat.ventes.filter((v) => !v.numero).sort((a, b) => a.cree_le.localeCompare(b.cree_le));
  const l = lot(etat);
  for (const v of sans) { v.numero = prochainNumero(etat); l.maj('ventes', v); }
  return { changes: l.changes, resultat: sans.length };
}

export function annulerVente(etat, id, opts) {
  const v = trouver(etat.ventes, id, 'Vente introuvable.');
  if (v.annule_le) return rien(v);
  const dettes = etat.dettes.filter((d) => d.vente_id === id && !d.annule_le);
  if (dettes.some((d) => dejaPaye(etat, d.id) > 0)) {
    echec("Cette vente a déjà reçu des paiements. Annule d'abord ces paiements dans la fiche du client.");
  }
  const quand = date(opts);
  const l = lot(etat);
  v.annule_le = quand;
  l.maj('ventes', v);
  for (const lg of etat.lignes_de_vente.filter((x) => x.vente_id === id)) {
    const a = etat.articles.find((x) => x.id === lg.article_id);
    if (a) { a.quantite += lg.quantite; a.modifie_le = quand; l.maj('articles', a); }
  }
  for (const m of etat.mouvements_caisse.filter((x) => x.reference_id === id && !x.annule_le)) {
    m.annule_le = quand;
    l.maj('mouvements_caisse', m);
  }
  for (const d of dettes) { d.annule_le = quand; l.maj('dettes', d); }
  return { changes: l.changes, resultat: v };
}

/* ---------- Dettes et paiements ---------- */

function paiementsAnnules(etat) {
  return new Set(etat.paiements_dette.filter((p) => p.annule_le).map((p) => p.id));
}

export function dejaPaye(etat, detteId, annules = paiementsAnnules(etat)) {
  let s = 0;
  for (const i of etat.imputations) if (i.dette_id === detteId && !annules.has(i.paiement_id)) s += i.montant;
  return s;
}

export function resteDette(etat, d, annules) {
  return d.annule_le ? 0 : d.montant - dejaPaye(etat, d.id, annules);
}

// entree = { id?, client_id, devise_dette, montant_recu, devise_recue?, mode?, note?, taux? }
export function encaisserPaiement(etat, entree, opts) {
  const p = exigerProfil(etat);
  const id = entree.id || uuid();
  const existe = etat.paiements_dette.find((x) => x.id === id);
  if (existe) return rien({ paiement: existe });

  const client = trouver(etat.clients, entree.client_id, 'Client introuvable.');
  const deviseDette = verifDevise(entree.devise_dette);
  const deviseRecue = verifDevise(entree.devise_recue ?? deviseDette);
  const taux = verifTaux(entree.taux ?? p.taux);
  const mode = verifMode(entree.mode || 'cash');
  const note = texteFacultatif(entree.note, 'La note', 120);
  const recu = entier(entree.montant_recu, 'Le montant', 1);

  const annules = paiementsAnnules(etat);
  const dettes = etat.dettes
    .filter((d) => d.client_id === client.id && d.devise === deviseDette && !d.annule_le)
    .map((d) => ({ d, reste: resteDette(etat, d, annules) }))
    .filter((x) => x.reste > 0)
    .sort((a, b) => a.d.cree_le.localeCompare(b.d.cree_le)); // la plus ancienne d'abord
  const reste = dettes.reduce((s, x) => s + x.reste, 0);
  if (reste <= 0) echec("Ce client n'a pas de dette à payer dans cette devise.");

  const maximum = convertir(reste, deviseDette, deviseRecue, taux);
  if (recu > maximum) echec(`Le montant dépasse le reste à payer (${formater(maximum, deviseRecue)}).`);
  const contre = Math.min(convertir(recu, deviseRecue, deviseDette, taux), reste);
  if (contre <= 0) echec('Le montant est trop petit.');

  const quand = date(opts);
  const l = lot(etat);
  const paiement = {
    id, client_id: client.id, devise: deviseDette, montant: contre,
    devise_recue: deviseRecue, montant_recu: recu, taux, mode, note,
    cree_le: quand, annule_le: null,
  };
  l.inserer('paiements_dette', paiement);
  let aRepartir = contre;
  for (const x of dettes) {
    if (!aRepartir) break;
    const part = Math.min(aRepartir, x.reste);
    l.inserer('imputations', { id: uuid(), paiement_id: id, dette_id: x.d.id, montant: part });
    aRepartir -= part;
  }
  l.inserer('mouvements_caisse', mouvement({
    type: 'entree', source: 'paiement_dette', reference_id: id, devise: deviseRecue, montant: recu,
    mode, montant_principal: convertir(recu, deviseRecue, p.devise_principale, taux), quand,
  }));
  return { changes: l.changes, resultat: { paiement, reste_apres: reste - contre, devise: deviseDette } };
}

export function annulerPaiement(etat, id, opts) {
  const pmt = trouver(etat.paiements_dette, id, 'Paiement introuvable.');
  if (pmt.annule_le) return rien(pmt);
  const quand = date(opts);
  const l = lot(etat);
  pmt.annule_le = quand;
  l.maj('paiements_dette', pmt);
  for (const m of etat.mouvements_caisse.filter((x) => x.reference_id === id && !x.annule_le)) {
    m.annule_le = quand;
    l.maj('mouvements_caisse', m);
  }
  return { changes: l.changes, resultat: pmt };
}

/* ---------- Dépenses ---------- */

function champsDepense(entree, p) {
  const devise = verifDevise(entree.devise ?? p.devise_principale);
  const montant = entier(entree.montant, 'Le montant', 1);
  const type = entree.type;
  if (!TYPES_DEPENSE.some((t) => t.id === type)) echec('Choisis le type de dépense.');
  return {
    montant, devise, type,
    mode: verifMode(entree.mode || 'cash'),
    note: texteFacultatif(entree.note, 'La note', 120),
  };
}

export function ajouterDepense(etat, entree, opts) {
  const p = exigerProfil(etat);
  const id = entree.id || uuid();
  const existe = etat.depenses.find((d) => d.id === id);
  if (existe) return rien(existe);
  const champs = champsDepense(entree, p);
  const taux = verifTaux(entree.taux ?? p.taux);
  const quand = date(opts);
  const dep = {
    id, ...champs, taux,
    montant_principal: convertir(champs.montant, champs.devise, p.devise_principale, taux),
    cree_le: quand, modifie_le: quand, annule_le: null,
  };
  const l = lot(etat);
  l.inserer('depenses', dep);
  l.inserer('mouvements_caisse', mouvement({
    type: 'sortie', source: 'depense', reference_id: id, devise: dep.devise, montant: dep.montant,
    mode: dep.mode, montant_principal: dep.montant_principal, quand,
  }));
  return { changes: l.changes, resultat: dep };
}

export function modifierDepense(etat, id, champs, opts) {
  const p = exigerProfil(etat);
  const dep = trouver(etat.depenses, id, 'Dépense introuvable.');
  if (dep.annule_le) echec('Cette dépense est annulée.');
  const n = champsDepense({ ...dep, ...champs }, p);
  const l = lot(etat);
  Object.assign(dep, n, {
    montant_principal: convertir(n.montant, n.devise, p.devise_principale, dep.taux),
    modifie_le: date(opts),
  });
  l.maj('depenses', dep);
  const m = etat.mouvements_caisse.find((x) => x.reference_id === id && !x.annule_le);
  if (m) {
    Object.assign(m, { devise: dep.devise, montant: dep.montant, mode: dep.mode, montant_principal: dep.montant_principal });
    l.maj('mouvements_caisse', m);
  }
  return { changes: l.changes, resultat: dep };
}

export function annulerDepense(etat, id, opts) {
  const dep = trouver(etat.depenses, id, 'Dépense introuvable.');
  if (dep.annule_le) return rien(dep);
  const quand = date(opts);
  const l = lot(etat);
  dep.annule_le = quand;
  l.maj('depenses', dep);
  for (const m of etat.mouvements_caisse.filter((x) => x.reference_id === id && !x.annule_le)) {
    m.annule_le = quand;
    l.maj('mouvements_caisse', m);
  }
  return { changes: l.changes, resultat: dep };
}

/* =================== LECTURES (calculs des écrans) =================== */

const actif = (x) => !x.annule_le;
const dansPeriode = (iso, debut, fin) => { const c = cleJour(iso); return c >= debut && c <= fin; };
const signe = (m) => (m.type === 'entree' ? 1 : -1);

// Solde physique de la caisse par devise et par mode (cash, M-Pesa…).
// `jusquA` (clé de jour, incluse) ou `avant` (clé de jour, exclue) pour un solde passé.
export function soldeCaisse(etat, { jusquA = null, avant = null } = {}) {
  const r = { USD: 0, CDF: 0, modes: {} };
  for (const m of etat.mouvements_caisse) {
    if (m.annule_le) continue;
    if (jusquA || avant) {
      const c = cleJour(m.cree_le);
      if (jusquA && c > jusquA) continue;
      if (avant && c >= avant) continue;
    }
    const v = signe(m) * m.montant;
    r[m.devise] += v;
    const md = (r.modes[m.mode] ??= { USD: 0, CDF: 0 });
    md[m.devise] += v;
  }
  return r;
}

// Totaux d'une période (clés de jour incluses), dans la devise principale.
// Dépenses d'achat de marchandise : le coût des articles vendus est déjà déduit vente par
// vente, on ne le compte donc pas une deuxième fois dans le bénéfice.
function depensesMarchandise(etat) {
  return new Set(etat.depenses.filter((d) => d.type === 'marchandise').map((d) => d.id));
}

// Totaux d'une période (clés de jour incluses), dans la devise principale.
//   marge    = ventes − prix d'achat des articles vendus
//   benefice = marge − dépenses (hors achats de marchandise)
export function statsPeriode(etat, debut, fin) {
  const r = { ventes: 0, nbVentes: 0, cout: 0, marge: 0, encaisse: 0, depenses: 0, depensesExploitation: 0, benefice: 0 };
  for (const v of etat.ventes) {
    if (actif(v) && dansPeriode(v.cree_le, debut, fin)) { r.ventes += v.total_principal; r.cout += v.cout_principal || 0; r.nbVentes++; }
  }
  const marchandise = depensesMarchandise(etat);
  for (const m of etat.mouvements_caisse) {
    if (!actif(m) || !dansPeriode(m.cree_le, debut, fin)) continue;
    if (m.type === 'entree') r.encaisse += m.montant_principal;
    else {
      r.depenses += m.montant_principal;
      if (!marchandise.has(m.reference_id)) r.depensesExploitation += m.montant_principal;
    }
  }
  r.marge = r.ventes - r.cout;
  r.benefice = r.marge - r.depensesExploitation;
  return r;
}

// Série pour les graphiques. `cases` = liste de { cle, debut, fin, libelle } ou des heures.
export function serie(etat, cases, parHeure = false) {
  const idx = new Map(cases.map((c, i) => [c.cle, i]));
  const res = cases.map((c) => ({ ...c, ventes: 0, entrees: 0, sorties: 0 }));
  const cleDe = (iso) => {
    if (parHeure) return cleJour(iso) === cases[0].jour ? String(heureNumero(iso)) : null;
    const j = cleJour(iso);
    return cases[0].mois ? j.slice(0, 7) : j;
  };
  for (const v of etat.ventes) {
    if (!actif(v)) continue;
    const i = idx.get(cleDe(v.cree_le));
    if (i !== undefined) res[i].ventes += v.total_principal;
  }
  for (const m of etat.mouvements_caisse) {
    if (!actif(m)) continue;
    const i = idx.get(cleDe(m.cree_le));
    if (i === undefined) continue;
    if (m.type === 'entree') res[i].entrees += m.montant_principal;
    else res[i].sorties += m.montant_principal;
  }
  return res;
}

function lignesActives(etat, debut, fin) {
  const ventes = new Set(etat.ventes.filter((v) => actif(v) && dansPeriode(v.cree_le, debut, fin)).map((v) => v.id));
  return etat.lignes_de_vente.filter((l) => ventes.has(l.vente_id));
}

export function ventesParCategorie(etat, debut, fin) {
  const m = new Map();
  for (const l of lignesActives(etat, debut, fin)) {
    const k = l.categorie || 'sans';
    m.set(k, (m.get(k) || 0) + l.montant_principal);
  }
  return [...m.entries()]
    .map(([id, valeur]) => {
      const c = infoCategorie(id);
      return { id, nom: c ? c.nom : 'Sans catégorie', couleur: c ? c.couleur : null, valeur };
    })
    .sort((a, b) => b.valeur - a.valeur);
}

export function meilleuresVentes(etat, debut, fin, n = 5) {
  const m = new Map();
  for (const l of lignesActives(etat, debut, fin)) {
    const x = m.get(l.article_id) || { article_id: l.article_id, nom: l.nom, categorie: l.categorie, quantite: 0, montant: 0 };
    x.quantite += l.quantite;
    x.montant += l.montant_principal;
    m.set(l.article_id, x);
  }
  return [...m.values()].sort((a, b) => b.quantite - a.quantite || b.montant - a.montant).slice(0, n);
}

export function bientotEnRupture(etat, n = 5) {
  const seuil = etat.profil?.seuil_stock_bas ?? 3;
  return articlesActifs(etat)
    .filter((a) => a.quantite <= seuil)
    .sort((a, b) => a.quantite - b.quantite || a.nom.localeCompare(b.nom))
    .slice(0, n);
}

// Détail d'une vente : lignes, client, dette, encaissements.
export function detailVente(etat, id) {
  const vente = trouver(etat.ventes, id, 'Vente introuvable.');
  const dettes = etat.dettes.filter((d) => d.vente_id === id);
  const reste = { USD: 0, CDF: 0 };
  const acomptes = { USD: 0, CDF: 0 };
  for (const d of dettes) { reste[d.devise] += resteDette(etat, d); acomptes[d.devise] += d.acompte; }
  return {
    vente,
    lignes: etat.lignes_de_vente.filter((l) => l.vente_id === id),
    client: vente.client_id ? etat.clients.find((c) => c.id === vente.client_id) || null : null,
    dettes,
    reste,
    acomptes,
    encaissements: etat.mouvements_caisse.filter((m) => m.reference_id === id),
  };
}

// Reste après chaque paiement, pour tous les clients : Map(paiement_id -> reste dans la devise de la dette).
function restesApresPaiements(etat) {
  const evenements = [];
  for (const d of etat.dettes) if (actif(d)) evenements.push({ quand: d.cree_le, client: d.client_id, devise: d.devise, delta: d.montant });
  for (const p of etat.paiements_dette) evenements.push({ quand: p.cree_le, client: p.client_id, devise: p.devise, delta: actif(p) ? -p.montant : 0, id: p.id });
  evenements.sort((a, b) => a.quand.localeCompare(b.quand) || (a.id ? 1 : 0) - (b.id ? 1 : 0));
  const courant = new Map();
  const res = new Map();
  for (const e of evenements) {
    const k = e.client + '|' + e.devise;
    const v = (courant.get(k) || 0) + e.delta;
    courant.set(k, v);
    if (e.id) res.set(e.id, v);
  }
  return res;
}

// Résumé des dettes par client (onglet Dettes).
export function dettesParClient(etat) {
  const p = exigerProfil(etat);
  const annules = paiementsAnnules(etat);
  const parClient = new Map();
  for (const d of etat.dettes) {
    if (!actif(d)) continue;
    const c = parClient.get(d.client_id) || { du: { USD: 0, CDF: 0 }, paye: { USD: 0, CDF: 0 }, reste: { USD: 0, CDF: 0 }, plusAncienne: null, factures: [] };
    const paye = dejaPaye(etat, d.id, annules);
    // Factures encore dues (une vente « $ + FC » peut avoir deux dettes pour la même facture).
    const vente = etat.ventes.find((v) => v.id === d.vente_id);
    if (d.montant - paye > 0 && vente?.numero && !c.factures.some((f) => f.numero === vente.numero)) {
      c.factures.push({ numero: vente.numero, date: vente.cree_le });
    }
    c.du[d.devise] += d.montant;
    c.paye[d.devise] += paye;
    c.reste[d.devise] += d.montant - paye;
    if (d.montant - paye > 0 && (!c.plusAncienne || d.cree_le < c.plusAncienne)) c.plusAncienne = d.cree_le;
    c.factures.sort((a, b) => a.numero - b.numero);
    parClient.set(d.client_id, c);
  }
  const versP = (x) => convertir(x.USD, 'USD', p.devise_principale, p.taux) + convertir(x.CDF, 'CDF', p.devise_principale, p.taux);
  return [...parClient.entries()].map(([id, c]) => ({
    client: etat.clients.find((k) => k.id === id),
    ...c,
    duP: versP(c.du),
    payeP: versP(c.paye),
    resteP: versP(c.reste),
    soldee: c.reste.USD <= 0 && c.reste.CDF <= 0,
  })).filter((x) => x.client).sort((a, b) => b.resteP - a.resteP || a.client.nom.localeCompare(b.client.nom));
}

export function totalARecevoir(etat) {
  const r = { USD: 0, CDF: 0 };
  for (const c of dettesParClient(etat)) { r.USD += c.reste.USD; r.CDF += c.reste.CDF; }
  return r;
}

// Paiements de dettes encaissés pendant une période (devise principale).
export function recuperePeriode(etat, debut, fin) {
  let s = 0;
  for (const m of etat.mouvements_caisse) {
    if (actif(m) && m.source === 'paiement_dette' && dansPeriode(m.cree_le, debut, fin)) s += m.montant_principal;
  }
  return s;
}

// Fiche complète d'un client : totaux par devise et historique (du plus récent au plus ancien).
export function ficheClient(etat, clientId) {
  const client = trouver(etat.clients, clientId, 'Client introuvable.');
  const resume = dettesParClient(etat).find((x) => x.client.id === clientId) || {
    du: { USD: 0, CDF: 0 }, paye: { USD: 0, CDF: 0 }, reste: { USD: 0, CDF: 0 }, soldee: true,
  };
  const apres = restesApresPaiements(etat);
  const evenements = [];
  for (const d of etat.dettes) {
    if (d.client_id !== clientId || !actif(d)) continue;
    evenements.push({
      type: 'achat', quand: d.cree_le, dette: d, devise: d.devise,
      numero: etat.ventes.find((v) => v.id === d.vente_id)?.numero ?? null,
      lignes: etat.lignes_de_vente.filter((l) => l.vente_id === d.vente_id),
    });
  }
  for (const p of etat.paiements_dette) {
    if (p.client_id !== clientId) continue;
    evenements.push({ type: 'paiement', quand: p.cree_le, paiement: p, devise: p.devise, reste_apres: apres.get(p.id) ?? 0 });
  }
  evenements.sort((a, b) => b.quand.localeCompare(a.quand));
  return { client, ...resume, historique: evenements };
}

// Libellé lisible d'un mouvement de caisse.
export function libelleMouvement(etat, m) {
  const nomClient = (cid) => etat.clients.find((c) => c.id === cid)?.nom || 'client';
  switch (m.source) {
    case 'vente': return 'Vente payée';
    case 'acompte': {
      const v = etat.ventes.find((x) => x.id === m.reference_id);
      return `Acompte de ${nomClient(v?.client_id)}`;
    }
    case 'paiement_dette': {
      const p = etat.paiements_dette.find((x) => x.id === m.reference_id);
      return `Paiement de ${nomClient(p?.client_id)}`;
    }
    case 'depense': {
      const d = etat.depenses.find((x) => x.id === m.reference_id);
      return `Dépense : ${typeDepense(d?.type).nom}`;
    }
    default: return 'Mouvement';
  }
}

// Journal de caisse d'une période, du plus récent au plus ancien (annulés inclus, pour la trace).
export function journalCaisse(etat, debut, fin, filtre = 'tout') {
  return etat.mouvements_caisse
    .filter((m) => dansPeriode(m.cree_le, debut, fin))
    .filter((m) => filtre === 'tout'
      || (filtre === 'entrees' && m.type === 'entree')
      || (filtre === 'sorties' && m.type === 'sortie')
      || (filtre === 'clients' && (m.source === 'paiement_dette' || m.source === 'acompte')))
    .sort((a, b) => b.cree_le.localeCompare(a.cree_le))
    .map((m) => ({ ...m, libelle: libelleMouvement(etat, m) }));
}

// Activité de chaque jour (pour la liste des rapports) : Map(cle -> { ventes, encaisse, depenses }).
export function activiteParJour(etat) {
  const r = new Map();
  const jour = (iso) => {
    const c = cleJour(iso);
    let x = r.get(c);
    if (!x) { x = { ventes: 0, cout: 0, encaisse: 0, depenses: 0, depensesExploitation: 0, benefice: 0, operations: 0 }; r.set(c, x); }
    return x;
  };
  const marchandise = depensesMarchandise(etat);
  for (const v of etat.ventes) {
    const x = jour(v.cree_le);
    x.operations++;
    if (actif(v)) { x.ventes += v.total_principal; x.cout += v.cout_principal || 0; }
  }
  for (const m of etat.mouvements_caisse) {
    const x = jour(m.cree_le);
    x.operations++;
    if (!actif(m)) continue;
    if (m.type === 'entree') x.encaisse += m.montant_principal;
    else {
      x.depenses += m.montant_principal;
      if (!marchandise.has(m.reference_id)) x.depensesExploitation += m.montant_principal;
    }
  }
  for (const x of r.values()) x.benefice = x.ventes - x.cout - x.depensesExploitation;
  return r;
}

// Rapport complet d'un jour.
export function rapportDuJour(etat, cle) {
  const p = exigerProfil(etat);
  const duJour = (x) => cleJour(x.cree_le) === cle;
  const client = (id) => etat.clients.find((c) => c.id === id) || null;
  const apres = restesApresPaiements(etat);

  const ventes = etat.ventes.filter(duJour).sort((a, b) => a.cree_le.localeCompare(b.cree_le)).map((v) => ({
    vente: v,
    lignes: etat.lignes_de_vente.filter((l) => l.vente_id === v.id),
    client: client(v.client_id),
    acompte: etat.dettes.some((d) => d.vente_id === v.id && d.acompte > 0),
  }));
  const paiements = etat.paiements_dette.filter(duJour).sort((a, b) => a.cree_le.localeCompare(b.cree_le))
    .map((pm) => ({ paiement: pm, client: client(pm.client_id), reste_apres: apres.get(pm.id) ?? 0 }));
  const nouvellesDettes = etat.dettes.filter((d) => duJour(d) && actif(d)).map((d) => ({
    dette: d, client: client(d.client_id), numero: etat.ventes.find((v) => v.id === d.vente_id)?.numero ?? null,
  }));
  const depenses = etat.depenses.filter(duJour).sort((a, b) => a.cree_le.localeCompare(b.cree_le));

  const articles = new Map();
  for (const x of ventes) {
    if (!actif(x.vente)) continue;
    for (const l of x.lignes) articles.set(l.nom, (articles.get(l.nom) || 0) + l.quantite);
  }
  const taux = new Set([
    ...ventes.map((x) => x.vente.taux), ...paiements.map((x) => x.paiement.taux), ...depenses.map((d) => d.taux),
  ]);
  return {
    cle,
    stats: statsPeriode(etat, cle, cle),
    nouvellesDettesTotal: nouvellesDettes.reduce((s, x) => s + convertir(x.dette.montant, x.dette.devise, p.devise_principale, x.dette.taux), 0),
    soldeDebut: soldeCaisse(etat, { avant: cle }),
    soldeFin: soldeCaisse(etat, { jusquA: cle }),
    ventes, paiements, nouvellesDettes, depenses,
    articlesVendus: [...articles.entries()].map(([nom, quantite]) => ({ nom, quantite })).sort((a, b) => b.quantite - a.quantite),
    taux: [...taux].sort((a, b) => a - b),
  };
}

// Factures (ventes) d'une période, de la plus récente à la plus ancienne, avec un résumé.
export function factures(etat, debut, fin) {
  const p = exigerProfil(etat);
  const liste = etat.ventes
    .filter((v) => dansPeriode(v.cree_le, debut, fin))
    .sort((a, b) => b.cree_le.localeCompare(a.cree_le))
    .map((v) => ({
      vente: v,
      lignes: etat.lignes_de_vente.filter((l) => l.vente_id === v.id),
      client: v.client_id ? etat.clients.find((c) => c.id === v.client_id) || null : null,
    }));
  const resume = { nombre: 0, payees: 0, credit: 0, annulees: 0, totaux: { USD: 0, CDF: 0 }, totalPrincipal: 0 };
  for (const { vente: v } of liste) {
    if (v.annule_le) { resume.annulees++; continue; }
    resume.nombre++;
    if (v.statut === 'credit') resume.credit++; else resume.payees++;
    const t = v.totaux ?? { USD: 0, CDF: 0, [v.devise]: v.total };
    resume.totaux.USD += t.USD;
    resume.totaux.CDF += t.CDF;
    resume.totalPrincipal += v.total_principal;
  }
  resume.devise = p.devise_principale;
  return { liste, resume };
}

export function premiereActivite(etat) {
  let min = null;
  for (const t of ['ventes', 'mouvements_caisse', 'paiements_dette']) {
    for (const x of etat[t]) if (!min || x.cree_le < min) min = x.cree_le;
  }
  return min ? cleJour(min) : null;
}
