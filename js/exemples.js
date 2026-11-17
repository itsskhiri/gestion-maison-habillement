// Données de démonstration : articles de mode, 30 jours de ventes, dettes avec paiements
// partiels et dépenses. Tout passe par le moteur, donc les chiffres respectent les mêmes règles.

import * as m from './moteur.js';
import { aujourdhui, ajouterJours, isoPourJour, maintenantIso } from './temps.js';
import { convertir } from './money.js';

// [nom, prix d'achat, devise, stock, catégorie]
const ARTICLES = [
  ['Robe pagne wax M', 1500, 'USD', 14, 'robes'],
  ['Robe de soirée satin', 2800, 'USD', 6, 'robes'],
  ['Jean slim 38', 1100, 'USD', 18, 'pantalons'],
  ['Pantalon chino beige', 900, 'USD', 12, 'pantalons'],
  ['Jupe plissée noire', 700, 'USD', 10, 'jupes'],
  ['Chemise blanche homme L', 800, 'USD', 15, 'chemises'],
  ['Chemise en lin', 1200, 'USD', 8, 'chemises'],
  ['T-shirt coton col rond', 9000, 'CDF', 26, 'tshirts'],
  ['Polo homme', 15000, 'CDF', 16, 'tshirts'],
  ['Veste en jean', 1700, 'USD', 7, 'vestes'],
  ['Manteau long femme', 3500, 'USD', 4, 'vestes'],
  ['Ensemble pagne enfant', 18000, 'CDF', 12, 'enfants'],
  ['Baskets blanches 40', 1900, 'USD', 9, 'chaussures'],
  ['Sandales en cuir', 21000, 'CDF', 10, 'chaussures'],
  ['Sac à main cuir', 2200, 'USD', 6, 'accessoires'],
  ['Ceinture homme', 6000, 'CDF', 15, 'accessoires'],
];

const CLIENTS = [
  ['Maman Furaha', '+243 990 000 111'], ['Jean-Paul Bisimwa', null], ['Aline Mushagalusa', '+243 970 000 222'],
  ['Patrick Cirhuza', null], ['Neema Bahati', '+243 850 000 333'], ['Espoir Kabare', null],
];

// Générateur pseudo-aléatoire fixe : les exemples sont identiques à chaque chargement.
function aleatoire(graine) {
  let a = graine;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fusionner(total, changes) {
  for (const [t, recs] of Object.entries(changes)) {
    const liste = (total[t] ??= []);
    for (const r of recs) if (!liste.includes(r)) liste.push(r);
  }
}

export function genererExemples(etat) {
  const p = m.exigerProfil(etat);
  const hasard = aleatoire(20261117);
  const entre = (a, b) => a + Math.floor(hasard() * (b - a + 1));
  const choisir = (liste) => liste[Math.floor(hasard() * liste.length)];
  const total = {};
  const faire = (r) => { fusionner(total, r.changes); return r.resultat; };
  // Jamais d'opération dans le futur (aujourd'hui, seulement jusqu'à l'heure actuelle).
  const maintenant = maintenantIso();
  const passe = (q) => q.date <= maintenant;

  const fin = aujourdhui();
  const debut = ajouterJours(fin, -29);
  const quandDebut = { date: isoPourJour(debut, 8, 0) };

  const articles = ARTICLES.map(([nom, prix_achat, devise, quantite, categorie]) =>
    faire(m.ajouterArticle(etat, { nom, prix_achat, devise, quantite: quantite * 2, categorie }, quandDebut)));

  const dettesOuvertes = [];
  for (let i = 0; i < 30; i++) {
    const jour = ajouterJours(debut, i);
    const taux = i < 15 ? 2800 : p.taux;
    // Le matin (8 h), avant les ventes du jour, quelques clients paient une partie de leur dette.
    for (const d of dettesOuvertes) {
      if (i - d.jour < 3 || hasard() > 0.1) continue;
      const fiche = m.ficheClient(etat, d.client_id);
      const reste = fiche.reste[p.devise_principale];
      if (reste <= 0) continue;
      const montant = hasard() < 0.3 ? reste : Math.max(1, Math.floor(reste / 3));
      const quandPaiement = { date: isoPourJour(jour, 8, entre(0, 59)) };
      if (!passe(quandPaiement)) continue;
      faire(m.encaisserPaiement(etat, {
        client_id: d.client_id, devise_dette: p.devise_principale, montant_recu: montant,
        mode: hasard() < 0.6 ? 'cash' : 'mpesa', taux,
      }, quandPaiement));
    }

    const nbVentes = entre(2, 6);
    // Heures de la journée triées : les numéros de facture suivent l'ordre des ventes.
    const heures = Array.from({ length: nbVentes }, () => entre(9 * 60, 18 * 60 + 59)).sort((x, y) => x - y);
    for (let k = 0; k < nbVentes; k++) {
      const dispo = articles.filter((a) => a.quantite > 0);
      if (!dispo.length) break;
      const lignes = [];
      const nbLignes = hasard() < 0.3 ? 2 : 1;
      for (let n = 0; n < nbLignes; n++) {
        const a = choisir(dispo);
        if (!lignes.some((l) => l.article_id === a.id)) lignes.push({ article_id: a.id, quantite: 1 });
      }
      const quand = { date: isoPourJour(jour, Math.floor(heures[k] / 60), heures[k] % 60) };
      if (!passe(quand)) continue;
      const mode = hasard() < 0.7 ? 'cash' : choisir(['mpesa', 'mpesa', 'airtel', 'orange']);
      // Prix de vente discuté pour chaque produit : 1,25 à 1,7 fois le prix d'achat,
      // arrondi au-dessus (1 $ ou 500 FC), jamais sous le prix d'achat.
      const avecPrix = (devise) => lignes.map((l) => {
        const a = articles.find((x) => x.id === l.article_id);
        const achat = m.prixAchatEn(a, devise, taux);
        const pas = devise === 'USD' ? 100 : 500;
        return { ...l, prix_unitaire: Math.max(achat, Math.ceil((achat * (1.25 + hasard() * 0.45)) / pas) * pas) };
      });
      const totalDe = (lg) => lg.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0);
      if (hasard() < 0.15) {
        const [nom, telephone] = choisir(CLIENTS);
        const lg = avecPrix(p.devise_principale);
        const acompte = hasard() < 0.5
          ? { devise: p.devise_principale, montant: Math.floor(totalDe(lg) / 3), mode: 'cash' }
          : null;
        const v = faire(m.creerVente(etat, {
          devise: p.devise_principale, taux, lignes: lg,
          paiement: { type: 'credit', client: { nom, telephone }, acompte: acompte?.montant ? acompte : null },
        }, quand));
        dettesOuvertes.push({ client_id: v.client_id, jour: i });
      } else {
        // Un tiers des clients paient en francs, même pour les articles affichés en dollars.
        const devise = hasard() < 0.33 ? 'CDF' : 'USD';
        const lg = avecPrix(devise);
        faire(m.creerVente(etat, {
          devise, taux, lignes: lg,
          paiement: { type: 'payee', encaissements: [{ devise, montant: totalDe(lg), mode }] },
        }, quand));
      }
    }

    // Dépenses
    const usd = (dollars) => convertir(dollars * 100, 'USD', p.devise_principale, taux);
    const quandDepense = { date: isoPourJour(jour, 8, 30) };
    const depense = (type, montant, note) => passe(quandDepense) && faire(m.ajouterDepense(etat, {
      type, montant, devise: p.devise_principale, note, taux,
    }, quandDepense));
    if (i === 0) depense('loyer', usd(200), 'Loyer du mois');
    if (i === 4 || i === 19) depense('marchandise', usd(150), 'Arrivage de Kampala');
    if (i === 10) depense('energie', usd(25), 'SNEL et REGIDESO');
    if (i === 27) depense('salaire', usd(80), 'Vendeuse');
    if (i % 3 === 1) depense('transport', usd(entre(2, 5)), null);
  }
  return total;
}
