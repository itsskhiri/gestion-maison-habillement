// Écran VENDRE : grille d'articles (avec leur PRIX D'ACHAT), panier, puis validation où le vendeur
// saisit le PRIX DE VENTE de chaque produit discuté avec le client (vente invalide sous le prix
// d'achat), paiement en $, en FC ou les deux,
// paiement cash / Mobile Money, vente à crédit avec acompte, reçu à partager, annulation, historique.

import * as api from './api.js';
import {
  h, icone, logo, pastille, boutonProfil, enTete, fm, fmMulti, fmVente, num, puces, segment, saisie, champ, champMontant,
  ouvrirFeuille, confirmer, toast, erreur, vibrer, partager, enCours, etatVide, optionsModes, vider,
} from './ui.js';
import { convertir, formater, lireEntier } from './money.js';
import { CATEGORIES, modePaiement } from './reference.js';
import { aujourdhui, heure, cleJour, libelleJour, dateNumerique } from './temps.js';
import { ouvrirFormulaireArticle } from './articles.js';

// État de l'écran conservé entre deux affichages (le panier ne se vide pas en changeant d'onglet).
const etatEcran = {
  panier: new Map(),   // article_id -> { quantite, prix: prix d'une pièce ou null, montants: { USD, CDF } en « $ + FC » }
  recherche: '',
  categorie: 'tout',
  deviseVente: null,   // 'USD', 'CDF' ou 'mixte' ($ + FC) — par défaut : devise principale
  taux: null,          // taux modifié pour la vente en cours (sinon taux du jour)
};

export async function afficher(racine) {
  const [p, articles, stats] = await Promise.all([
    api.profil(), api.listerArticles(), api.statsPeriode(aujourdhui(), aujourdhui()),
  ]);
  const parId = new Map(articles.map((a) => [a.id, a]));
  for (const [id, x] of etatEcran.panier) {
    const a = parId.get(id);
    if (!a || a.quantite <= 0) etatEcran.panier.delete(id);
    else if (x.quantite > a.quantite) x.quantite = a.quantite;
  }
  const ctx = { p, parId };

  racine.append(
    h('header', { class: 'entete entete-vendre' },
      logo(p.nom_boutique, 40),
      h('div', { class: 'entete-nom' }, p.nom_boutique),
      h('div', { class: 'entete-actions' },
        h('a', { class: 'btn-icone', href: '#/ventes', 'aria-label': 'Historique des ventes' }, icone('historique', 24)),
        boutonProfil())),
    h('section', { class: 'resume-jour' },
      h('p', { class: 'legende' }, 'Ventes du jour'),
      h('p', { class: 'chiffre-xl' }, fm(stats.ventes, p.devise_principale)),
      h('div', { class: 'resume-jour-pied' },
        h('span', { class: 'texte-2' }, 'Bénéfice ', num(fm(stats.benefice, p.devise_principale), stats.benefice < 0 ? 'negatif' : ''),
          ` · ${stats.nbVentes} vente${stats.nbVentes > 1 ? 's' : ''}`),
        h('button', { class: 'puce-taux', onclick: () => feuilleTaux(p), 'aria-label': 'Modifier le taux du jour' },
          `1 $ = ${formater(p.taux, 'CDF')}`, icone('crayon', 14)))),
  );

  if (!articles.length) {
    racine.append(etatVide({
      icone: 'articles', titre: 'Aucun article pour l’instant',
      texte: 'Ajoute tes robes, jeans, chaussures… avec leur prix d’achat et leur stock pour commencer à vendre.',
      action: { libelle: 'Ajouter un article', icone: 'plus', onclick: () => ouvrirFormulaireArticle(p) },
    }));
    return;
  }

  // Recherche et filtre par catégorie
  const categoriesPresentes = CATEGORIES.filter((c) => articles.some((a) => a.categorie === c.id));
  const optionsCat = [{ id: 'tout', libelle: 'Tout' }, ...categoriesPresentes.map((c) => ({ id: c.id, libelle: c.nom, couleur: c.couleur }))];
  if (!optionsCat.some((o) => o.id === etatEcran.categorie)) etatEcran.categorie = 'tout';

  const grille = h('div', { class: 'grille-articles' });
  const cartes = new Map();
  const recherche = saisie({
    type: 'search', placeholder: 'Rechercher un article', value: etatEcran.recherche, enterkeyhint: 'search', 'aria-label': 'Rechercher un article',
    oninput: () => { etatEcran.recherche = recherche.value; dessinerGrille(); },
  });
  racine.append(h('div', { class: 'barre-outils' },
    h('div', { class: 'recherche' }, icone('recherche', 20), recherche),
    categoriesPresentes.length ? puces(optionsCat, etatEcran.categorie, (c) => { etatEcran.categorie = c || 'tout'; dessinerGrille(); }, { defilante: true, libelle: 'Catégories' }) : null));
  racine.append(grille);

  function carteArticle(a) {
    const dansPanier = etatEcran.panier.get(a.id)?.quantite || 0;
    const epuise = a.quantite <= 0;
    const bas = !epuise && a.quantite <= p.seuil_stock_bas;
    const carte = h('button', {
      class: `carte-article${epuise ? ' epuise' : ''}${dansPanier ? ' dans-panier' : ''}`,
      'aria-label': `${a.nom}, prix d'achat ${formater(a.prix_achat, a.devise)}${epuise ? ', épuisé' : `, stock ${a.quantite}`}${dansPanier ? `, ${dansPanier} dans le panier` : ''}`,
      'aria-disabled': epuise ? 'true' : null,
      onclick: () => ajouter(a),
    },
    pastille(a.categorie, a.nom, 32),
    h('span', { class: 'carte-article-nom' }, a.nom),
    h('div', { class: 'carte-article-pied' },
      h('span', { class: 'carte-article-prix' },
        h('span', { class: 'carte-article-etiquette' }, 'Achat'),
        formater(a.prix_achat, a.devise)),
      epuise ? h('span', { class: 'badge badge-zero' }, 'Épuisé') : bas ? h('span', { class: 'badge badge-bas' }, `Reste ${a.quantite}`) : null),
    dansPanier ? h('span', { class: 'compteur', 'aria-hidden': 'true' }, String(dansPanier)) : null);
    // Bouton « − » sur la carte : corrige un toucher en trop sans ouvrir le panier.
    const el = h('div', { class: 'carte-article-conteneur' }, carte,
      dansPanier ? h('button', { class: 'retirer-un', 'aria-label': `Retirer un « ${a.nom} » du panier`, onclick: () => retirer(a) }, icone('moins', 20)) : null);
    cartes.set(a.id, el);
    return el;
  }

  function retirer(a) {
    const x = etatEcran.panier.get(a.id);
    if (!x) return;
    x.quantite--;
    if (x.quantite <= 0) etatEcran.panier.delete(a.id);
    vibrer(8);
    rafraichirCarte(a.id);
    majBarre();
  }

  function dessinerGrille() {
    const q = etatEcran.recherche.trim().toLowerCase();
    const liste = articles.filter((a) => (etatEcran.categorie === 'tout' || a.categorie === etatEcran.categorie)
      && (!q || a.nom.toLowerCase().includes(q)));
    vider(grille);
    cartes.clear();
    if (!liste.length) grille.append(h('p', { class: 'liste-vide', style: 'grid-column:1/-1' }, 'Aucun article ne correspond.'));
    else grille.append(...liste.map(carteArticle));
  }

  function ajouter(a) {
    if (a.quantite <= 0) { toast(`« ${a.nom} » est épuisé.`); return; }
    const x = etatEcran.panier.get(a.id) || { quantite: 0, prix: null };
    if (x.quantite >= a.quantite) { toast(`Il ne reste que ${a.quantite} « ${a.nom} » en stock.`); return; }
    x.quantite++;
    etatEcran.panier.set(a.id, x);
    vibrer(8);
    rafraichirCarte(a.id);
    majBarre();
  }

  function rafraichirCarte(id) {
    const ancienne = cartes.get(id);
    if (ancienne?.isConnected) ancienne.replaceWith(carteArticle(parId.get(id)));
  }

  // Barre du panier (en bas, au-dessus de la navigation)
  const resumePanier = h('button', { class: 'barre-panier-resume', onclick: () => feuillePanier(ctx, majTout) });
  const validerBtn = h('button', { class: 'btn', onclick: () => feuillePaiement(ctx) }, 'Valider la vente');
  const barre = h('div', { class: 'barre-panier', 'aria-live': 'polite' },
    h('div', { class: 'barre-panier-contenu' }, resumePanier, validerBtn));
  racine.append(barre);

  function majBarre() {
    const lignes = lignesPanier(ctx);
    const n = lignes.reduce((s, l) => s + l.quantite, 0);
    barre.classList.toggle('visible', n > 0);
    document.body.classList.toggle('avec-panier', n > 0);
    resumePanier.setAttribute('aria-label', `Voir le panier : ${n} article${n > 1 ? 's' : ''}`);
    resumePanier.replaceChildren(
      h('span', { class: 'barre-panier-icone' }, icone('panier', 24), h('span', { class: 'barre-panier-nombre' }, String(n))),
      h('span', { class: 'barre-panier-textes' },
        h('span', { class: 'barre-panier-lien' }, 'Voir le panier'),
        h('span', { class: 'barre-panier-cout' }, `${n} article${n > 1 ? 's' : ''}`)));
  }
  function majTout() { dessinerGrille(); majBarre(); }

  dessinerGrille();
  majBarre();
}

// Mode des prix de vente : 'USD', 'CDF' ou 'mixte' ($ + FC : chaque produit est payé en dollars
// et/ou en francs, la partie en francs étant convertie au taux de la vente).
const modePrix = (ctx) => etatEcran.deviseVente ?? ctx.p.devise_principale;
// Devise « de référence » envoyée au moteur (la devise principale pour une vente $ + FC).
const deviseReference = (ctx) => (modePrix(ctx) === 'mixte' ? ctx.p.devise_principale : modePrix(ctx));
// Taux de cette vente : celui du jour, modifiable pour une seule vente.
const tauxVente = (ctx) => etatEcran.taux ?? ctx.p.taux;

// Lignes du panier, avec pour chacune : `montants` ({ USD, CDF } payés pour la ligne),
// `manquant` (rien saisi), `invalide` (sous le prix d'achat) et le coût en devise principale.
function lignesPanier(ctx) {
  const mode = modePrix(ctx);
  const t = tauxVente(ctx);
  return [...etatEcran.panier].filter(([id]) => ctx.parId.has(id)).map(([id, x]) => {
    const a = ctx.parId.get(id);
    const cout = convertir(a.prix_achat * x.quantite, a.devise, ctx.p.devise_principale, t);
    if (mode === 'mixte') {
      const montants = { USD: x.montants?.USD || 0, CDF: x.montants?.CDF || 0 };
      const manquant = !montants.USD && !montants.CDF;
      // Valeur payée et prix d'achat comparés dans la devise du prix d'achat.
      const valeur = convertir(montants.USD, 'USD', a.devise, t) + convertir(montants.CDF, 'CDF', a.devise, t);
      const achatTotal = a.prix_achat * x.quantite;
      return { a, x, quantite: x.quantite, devise: 'mixte', montants, manquant, valeur, achatTotal, invalide: !manquant && valeur < achatTotal, cout };
    }
    const achat = convertir(a.prix_achat, a.devise, mode, t);
    const prix = x.prix ?? null;
    return {
      a, x, quantite: x.quantite, devise: mode, achat, prix,
      montants: { USD: 0, CDF: 0, [mode]: prix != null ? prix * x.quantite : 0 },
      manquant: prix == null, invalide: prix != null && prix < achat, cout,
    };
  });
}
const coutPanier = (ctx) => lignesPanier(ctx).reduce((s, l) => s + l.cout, 0);

// Totaux par devise (« Total dollars », « Total francs ») ; null si un prix manque.
function totauxPanier(ctx) {
  const lignes = lignesPanier(ctx);
  if (lignes.some((l) => l.manquant)) return null;
  const t = { USD: 0, CDF: 0 };
  for (const l of lignes) { t.USD += l.montants.USD; t.CDF += l.montants.CDF; }
  return t;
}

// « 10 $ + 17 100 FC »
const fmMontants = (m) => ['USD', 'CDF'].filter((d) => m[d]).map((d) => formater(m[d], d)).join(' + ') || '—';

/* ---------- Panier ---------- */

function feuillePanier(ctx, majEcran) {
  let f = null;
  const dev = ctx.p.devise_principale;
  const rafraichir = () => {
    majEcran();
    if (!etatEcran.panier.size) { f.fermer(); return; }
    f.remplacer(contenu());
  };

  function contenu() {
    const lignes = lignesPanier(ctx);
    return h('div', { class: 'pile' },
      h('div', {},
        ...lignes.map((l) => {
          const x = l.x;
          const moins = h('button', { class: 'btn-rond', 'aria-label': `Retirer un « ${l.a.nom} »`, onclick: () => {
            x.quantite--;
            if (x.quantite <= 0) etatEcran.panier.delete(l.a.id);
            rafraichir();
          } }, icone(x.quantite > 1 ? 'moins' : 'corbeille', 20));
          const plus = h('button', { class: 'btn-rond', 'aria-label': `Ajouter un « ${l.a.nom} »`, disabled: x.quantite >= l.a.quantite, onclick: () => { x.quantite++; rafraichir(); } }, icone('plus', 20));
          return h('div', { class: 'ligne-panier' },
            h('div', { class: 'ligne-panier-tete' },
              h('span', { class: 'ligne-panier-nom' }, l.a.nom),
              h('div', { class: 'stepper' }, moins, h('span', { class: 'stepper-valeur', 'aria-live': 'polite' }, String(x.quantite)), plus)),
            h('span', { class: 'texte-2', style: 'font-size:15px' }, `Prix d'achat : ${formater(l.a.prix_achat, l.a.devise)} / pièce`));
        })),
      h('div', { class: 'total-panier' },
        h('span', { class: 'texte-2' }, 'Prix d’achat total'),
        h('span', { class: 'chiffre-m' }, fm(coutPanier(ctx), dev))),
      h('button', { class: 'btn btn-principal btn-grand btn-bloc', onclick: () => { f.fermer(); feuillePaiement(ctx); } }, 'Valider la vente'),
      h('button', { class: 'btn-texte-danger', onclick: () => { etatEcran.panier.clear(); rafraichir(); } }, 'Vider le panier'));
  }

  f = ouvrirFeuille({ titre: 'Panier', contenu: h('div') });
  f.remplacer(contenu());
}

/* ---------- Validation : un prix de vente pour CHAQUE produit ---------- */

// Vérifie que chaque produit a un prix valide ; signale le premier problème.
function verifierPrix(ctx, champsPrix) {
  const lignes = lignesPanier(ctx);
  const sansPrix = lignes.find((l) => l.manquant);
  if (sansPrix) {
    champsPrix.get(sansPrix.a.id)?.signalerErreur();
    throw new api.ErreurMetier(sansPrix.devise === 'mixte'
      ? `Saisis ce que le client paie pour « ${sansPrix.a.nom} ».`
      : `Saisis le prix de vente de « ${sansPrix.a.nom} ».`);
  }
  const invalide = lignes.find((l) => l.invalide);
  if (invalide) {
    champsPrix.get(invalide.a.id)?.signalerErreur();
    const achat = invalide.devise === 'mixte' ? formater(invalide.achatTotal, invalide.a.devise) : formater(invalide.achat, invalide.devise);
    throw new api.ErreurMetier(`Vente invalide : « ${invalide.a.nom} » est sous son prix d'achat (${achat}).`);
  }
  return lignes;
}

// Bloc des totaux : un total par devise vendue, puis le bénéfice.
function blocTotaux(totaux, beneficeP, devisePrincipale, { mixte, taux }) {
  const lignes = [];
  for (const d of ['USD', 'CDF']) {
    if (!mixte && !totaux[d]) continue;
    lignes.push(h('div', { class: 'total-devise' },
      h('span', { class: 'texte-2' }, mixte ? (d === 'USD' ? 'Total dollars' : 'Total francs') : 'Total'),
      h('span', { class: mixte ? 'chiffre-m' : 'chiffre-l' }, fm(totaux[d], d))));
  }
  // Vente $ + FC : valeur de toute la vente, convertie au taux de la vente.
  if (mixte) {
    const enDollars = totaux.USD + convertir(totaux.CDF, 'CDF', 'USD', taux);
    const enFrancs = totaux.CDF + convertir(totaux.USD, 'USD', 'CDF', taux);
    lignes.push(h('p', { class: 'champ-aide', style: 'text-align:right;font-size:15px' },
      'Soit en tout : ', h('strong', { class: 'num' }, `${formater(enDollars, 'USD')} = ${formater(enFrancs, 'CDF')}`)));
  }
  return h('div', { class: 'pile-serree' }, ...lignes,
    beneficeP != null ? h('p', { class: `champ-aide ${beneficeP >= 0 ? 'positif' : 'negatif'}`, style: 'text-align:right' },
      `Bénéfice : ${formater(beneficeP, devisePrincipale, { signe: true })}`) : null);
}

function feuillePaiement(ctx) {
  if (!lignesPanier(ctx).length) return;
  const p = ctx.p;
  let mode = 'cash';
  const champsPrix = new Map();

  // Taux de cette vente (pour la partie en francs et les conversions), modifiable.
  const champTaux = saisie({ inputmode: 'numeric', value: String(tauxVente(ctx)), 'aria-label': 'Taux de cette vente : francs pour 1 dollar' });
  champTaux.addEventListener('input', () => {
    const v = lireEntier(champTaux.value);
    champTaux.classList.toggle('invalide', !v);
    if (!v) return;
    etatEcran.taux = v === p.taux ? null : v;
    dessinerLignes();
    majTotal();
  });
  const zoneLignes = h('div', { class: 'lignes-vente' });
  const zoneTotal = h('div', { class: 'total-vente', 'aria-live': 'polite' });

  // --- Prix de chaque produit ---
  function dessinerLignes() {
    const mixte = modePrix(ctx) === 'mixte';
    champsPrix.clear();
    vider(zoneLignes);
    for (const l0 of lignesPanier(ctx)) zoneLignes.append(mixte ? ligneMixte(l0) : ligneSimple(l0));
  }

  // Ligne « Dollars » ou « Francs » : un prix de vente pour une pièce.
  function ligneSimple(l0) {
    const etat = h('p', { class: 'ligne-vente-etat' });
    const totalLigne = h('span', { class: 'ligne-vente-total num' });
    const champPrix = champMontant({
      devise: l0.devise, valeur: l0.prix, avecDevise: false, libelle: 'Prix de vente / pièce',
      onSaisie: () => { l0.x.prix = champPrix.lire(); majLigne(); majTotal(); },
    });
    champPrix.entree.setAttribute('aria-label', `Prix de vente de « ${l0.a.nom} », une pièce`);
    champsPrix.set(l0.a.id, champPrix);
    const bloc = h('div', { class: 'ligne-vente' },
      enteteLigne(l0, totalLigne),
      h('span', { class: 'ligne-vente-achat' }, `Prix d'achat : ${formater(l0.achat, l0.devise)} / pièce`),
      champPrix.el,
      etat);
    function majLigne() {
      const l = lignesPanier(ctx).find((x) => x.a.id === l0.a.id);
      bloc.classList.toggle('invalide', l.invalide);
      totalLigne.textContent = l.manquant ? '' : formater(l.montants[l.devise], l.devise);
      if (l.invalide) etatLigne(etat, 'negatif', `Vente invalide : prix inférieur au prix d'achat (${formater(l.achat, l.devise)})`);
      else if (!l.manquant) etatLigne(etat, 'positif', `Bénéfice : ${formater((l.prix - l.achat) * l.quantite, l.devise, { signe: true })}`);
      else etatLigne(etat, '', '');
    }
    majLigne();
    return bloc;
  }

  // Ligne « $ + FC » : ce que le client paie pour ce produit, en dollars et en francs.
  function ligneMixte(l0) {
    const etat = h('p', { class: 'ligne-vente-etat' });
    const totalLigne = h('span', { class: 'ligne-vente-total num' });
    const pieces = l0.quantite > 1 ? ` (les ${l0.quantite})` : '';
    const changer = () => {
      l0.x.montants = { USD: champUSD.lire() || 0, CDF: champFC.lire() || 0 };
      majLigne();
      majTotal();
    };
    const champUSD = champMontant({ devise: 'USD', valeur: l0.montants.USD || null, avecDevise: false, libelle: 'En dollars', onSaisie: changer });
    const champFC = champMontant({ devise: 'CDF', valeur: l0.montants.CDF || null, avecDevise: false, libelle: 'En francs', onSaisie: changer });
    champUSD.entree.setAttribute('aria-label', `« ${l0.a.nom} » : payé en dollars`);
    champFC.entree.setAttribute('aria-label', `« ${l0.a.nom} » : payé en francs`);
    champsPrix.set(l0.a.id, champUSD);
    const bloc = h('div', { class: 'ligne-vente' },
      enteteLigne(l0, totalLigne),
      h('span', { class: 'ligne-vente-achat' }, `Prix d'achat${pieces} : ${formater(l0.achatTotal, l0.a.devise)}`),
      h('span', { class: 'champ-libelle' }, `Le client paie${pieces}`),
      h('div', { class: 'duo duo-montants' }, champUSD.el, champFC.el),
      etat);
    function majLigne() {
      const l = lignesPanier(ctx).find((x) => x.a.id === l0.a.id);
      const dev = l.a.devise;
      bloc.classList.toggle('invalide', l.invalide);
      totalLigne.textContent = l.manquant ? '' : fmMontants(l.montants);
      const valeur = `Valeur : ${formater(l.valeur, dev)}`;
      if (l.invalide) etatLigne(etat, 'negatif', `Vente invalide : ${valeur}, sous le prix d'achat (${formater(l.achatTotal, dev)})`);
      else if (!l.manquant) etatLigne(etat, 'positif', `${valeur} · Bénéfice : ${formater(l.valeur - l.achatTotal, dev, { signe: true })}`);
      else etatLigne(etat, '', '');
    }
    majLigne();
    return bloc;
  }

  const enteteLigne = (l, totalLigne) => h('div', { class: 'ligne-vente-tete' },
    h('span', { class: 'ligne-vente-nom' }, l.a.nom, l.quantite > 1 ? h('span', { class: 'ligne-vente-qte' }, ` × ${l.quantite}`) : null),
    totalLigne);
  const etatLigne = (el, classe, texte) => { el.className = `ligne-vente-etat ${classe}`; el.textContent = texte; };

  // --- Totaux (dollars et francs) et bénéfice ---
  function majTotal() {
    const lignes = lignesPanier(ctx);
    const manquants = lignes.filter((l) => l.manquant).length;
    const invalides = lignes.filter((l) => l.invalide).length;
    const totaux = totauxPanier(ctx);
    vider(zoneTotal);
    if (invalides) {
      zoneTotal.append(h('p', { class: 'champ-aide negatif' }, `Vente invalide : ${invalides} produit${invalides > 1 ? 's sont vendus' : ' est vendu'} sous le prix d'achat. Corrige le prix en rouge.`));
    } else if (manquants) {
      zoneTotal.append(h('p', { class: 'champ-aide' }, `Saisis le prix de vente de ${manquants > 1 ? `${manquants} produits` : 'ce produit'}.`));
    }
    if (totaux) {
      const venteP = convertir(totaux.USD, 'USD', p.devise_principale, tauxVente(ctx)) + convertir(totaux.CDF, 'CDF', p.devise_principale, tauxVente(ctx));
      zoneTotal.append(blocTotaux(totaux, invalides ? null : venteP - coutPanier(ctx), p.devise_principale, { mixte: modePrix(ctx) === 'mixte', taux: tauxVente(ctx) }));
    }
  }

  const payer = h('button', { class: 'btn btn-principal btn-grand btn-bloc' }, icone('coche', 22), 'Payé');
  payer.addEventListener('click', enCours(payer, async () => {
    try {
      verifierPrix(ctx, champsPrix);
      // Le client paie les dollars en dollars et les francs en francs.
      const totaux = totauxPanier(ctx);
      const encaissements = ['USD', 'CDF'].filter((d) => totaux[d] > 0).map((d) => ({ devise: d, montant: totaux[d], mode }));
      await enregistrerVente(ctx, { type: 'payee', encaissements }, f);
    } catch (e) { erreur(e); }
  }));
  const credit = h('button', { class: 'btn btn-secondaire btn-grand btn-bloc' }, 'À crédit');
  credit.addEventListener('click', () => {
    try {
      verifierPrix(ctx, champsPrix);
      f.fermer();
      feuilleCredit(ctx);
    } catch (e) { erreur(e); }
  });

  const f = ouvrirFeuille({
    titre: 'Valider la vente',
    contenu: h('div', { class: 'pile' },
      h('div', { class: 'champ' },
        h('span', { class: 'champ-libelle' }, 'Prix de vente en'),
        segment([{ id: 'USD', libelle: 'Dollars' }, { id: 'CDF', libelle: 'Francs' }, { id: 'mixte', libelle: '$ + FC' }], modePrix(ctx), (nouveau) => {
          // Les prix déjà saisis suivent : un prix simple devient la part de cette devise en « $ + FC » ;
          // en quittant « $ + FC », les montants sont à saisir de nouveau.
          for (const l of lignesPanier(ctx)) {
            if (nouveau === 'mixte') l.x.montants = l.manquant ? null : { ...l.montants };
            else if (l.devise === 'mixte') { l.x.prix = null; l.x.montants = null; }
            else if (l.x.prix != null) l.x.prix = convertir(l.x.prix, l.devise, nouveau, tauxVente(ctx));
          }
          etatEcran.deviseVente = nouveau;
          dessinerLignes();
          majTotal();
        }, { libelle: 'Devise des prix de vente' })),
      h('label', { class: 'taux-vente' },
        h('span', { class: 'champ-libelle' }, 'Taux de cette vente'),
        h('span', { class: 'rangee' }, h('span', { class: 'texte-2' }, '1 $ ='), champTaux, h('span', { class: 'texte-2' }, 'FC'))),
      zoneLignes,
      h('div', { class: 'champ' },
        h('span', { class: 'champ-libelle' }, 'Mode de paiement'),
        puces(optionsModes(), mode, (m) => { mode = m || 'cash'; }, { libelle: 'Mode de paiement' })),
      zoneTotal, // totaux tout en bas, juste au-dessus de « Payé »
      payer,
      credit),
  });
  dessinerLignes();
  majTotal();
  setTimeout(() => champsPrix.values().next().value?.entree.focus(), 260);
}

async function enregistrerVente(ctx, paiement, feuille) {
  const lignes = lignesPanier(ctx);
  const entree = {
    devise: deviseReference(ctx),
    taux: tauxVente(ctx),
    lignes: lignes.map((l) => (l.devise === 'mixte'
      ? { article_id: l.a.id, quantite: l.quantite, montants: l.montants }
      : { article_id: l.a.id, quantite: l.quantite, prix_unitaire: l.prix, devise: l.devise })),
    paiement,
  };
  // Le panier est vidé AVANT l'enregistrement (l'écran se redessine aussitôt après),
  // et remis tel quel si l'enregistrement est refusé.
  const panierAvant = new Map([...etatEcran.panier].map(([k, x]) => [k, { ...x }]));
  const tauxAvant = etatEcran.taux;
  etatEcran.panier.clear();
  etatEcran.taux = null;
  let v;
  try {
    v = await api.creerVente(entree);
  } catch (e) {
    etatEcran.panier = panierAvant;
    etatEcran.taux = tauxAvant;
    throw e;
  }
  feuille.fermer();
  vibrer([10, 30, 10]);
  const recu = await ouvrirRecu(v.id, { nouvelle: true });
  toast('Vente enregistrée', {
    action: 'Annuler', duree: 6000,
    onAction: async () => {
      try { await api.annulerVente(v.id); recu?.fermer(); toast('Vente annulée. Le stock est remis.'); } catch (e) { erreur(e); }
    },
  });
}

/* ---------- Vente à crédit (les prix de chaque produit sont déjà saisis) ---------- */

async function feuilleCredit(ctx) {
  const p = ctx.p;
  const t = tauxVente(ctx);
  const mixte = modePrix(ctx) === 'mixte';
  const totaux = totauxPanier(ctx);
  const devises = ['USD', 'CDF'].filter((d) => totaux[d] > 0);
  const clients = await api.listerClients();
  let choisi = null; // id d'un client existant
  let modeAcompte = 'cash';

  const nom = saisie({ placeholder: 'Nom du client', autocapitalize: 'words', maxlength: 60, 'aria-label': 'Nom du client' });
  const telephone = saisie({ type: 'tel', inputmode: 'tel', placeholder: 'Téléphone (facultatif)', maxlength: 20, 'aria-label': 'Téléphone du client' });
  const zoneTel = h('div', { hidden: true }, telephone);
  const listeClients = h('div', { class: 'choix-client', role: 'list' });
  const reste = h('p', { class: 'texte-2' });
  const acompte = champMontant({ devise: devises[0], libelle: 'Acompte payé maintenant (facultatif)', onSaisie: majReste });
  const zoneModeAcompte = h('div', { class: 'champ', hidden: true },
    h('span', { class: 'champ-libelle' }, 'Acompte reçu par'),
    puces(optionsModes(), modeAcompte, (m) => { modeAcompte = m || 'cash'; }, { libelle: 'Mode de paiement de l’acompte' }));

  // Reste à crédit par devise (un acompte réduit la dette de sa devise ; converti si une seule devise).
  function majReste() {
    const a = acompte.lire() || 0;
    zoneModeAcompte.hidden = !a;
    const r = { ...totaux };
    if (a) {
      if (devises.length === 1) r[devises[0]] -= convertir(a, acompte.devise(), devises[0], t);
      else r[acompte.devise()] -= a;
    }
    reste.replaceChildren('Reste à crédit : ', h('strong', { class: 'num' }, fmMulti({ USD: Math.max(0, r.USD), CDF: Math.max(0, r.CDF) }, p.devise_principale)));
  }

  function dessinerClients() {
    const q = nom.value.trim().toLowerCase();
    const trouves = clients.filter((c) => !q || c.nom.toLowerCase().includes(q)).slice(0, 6);
    const exact = clients.some((c) => c.nom.toLowerCase() === q);
    vider(listeClients);
    for (const c of trouves) {
      listeClients.append(h('button', {
        class: 'liste-ligne', type: 'button', role: 'listitem', 'aria-pressed': String(choisi === c.id),
        onclick: () => { choisi = c.id; nom.value = c.nom; zoneTel.hidden = true; dessinerClients(); },
      }, h('span', { class: 'icone-ronde' }, icone('profil', 20)),
      h('span', { class: 'liste-ligne-corps' },
        h('span', { class: 'liste-ligne-titre' }, c.nom),
        c.telephone ? h('span', { class: 'liste-ligne-sous' }, c.telephone) : null),
      choisi === c.id ? icone('coche', 20, 'positif') : null));
    }
    if (q && !exact) {
      listeClients.append(h('button', {
        class: 'liste-ligne', type: 'button', role: 'listitem', 'aria-pressed': String(choisi === null),
        onclick: () => { choisi = null; zoneTel.hidden = false; telephone.focus(); dessinerClients(); },
      }, h('span', { class: 'icone-ronde accent' }, icone('plus', 20)),
      h('span', { class: 'liste-ligne-corps' }, h('span', { class: 'liste-ligne-titre' }, `Nouveau client : « ${nom.value.trim()} »`))));
    }
  }
  nom.addEventListener('input', () => {
    const c = clients.find((x) => x.id === choisi);
    if (c && c.nom !== nom.value) choisi = null;
    zoneTel.hidden = !nom.value.trim() || clients.some((x) => x.nom.toLowerCase() === nom.value.trim().toLowerCase());
    nom.classList.remove('invalide');
    dessinerClients();
  });

  const valider = h('button', { class: 'btn btn-principal btn-grand btn-bloc' }, 'Enregistrer la vente à crédit');
  valider.addEventListener('click', enCours(valider, async () => {
    try {
      if (!choisi && !nom.value.trim()) { nom.classList.add('invalide'); nom.focus(); throw new api.ErreurMetier('Choisis le client ou saisis son nom.'); }
      const a = acompte.lire();
      if (acompte.entree.value.trim() && a == null) { acompte.signalerErreur(); throw new api.ErreurMetier("Le montant de l'acompte n'est pas valide."); }
      await enregistrerVente(ctx, {
        type: 'credit',
        client: choisi ? { id: choisi } : { nom: nom.value, telephone: telephone.value },
        acompte: a ? { devise: acompte.devise(), montant: a, mode: modeAcompte } : null,
      }, f);
    } catch (e) { erreur(e); }
  }));

  const f = ouvrirFeuille({
    titre: 'Vente à crédit',
    contenu: h('div', { class: 'pile' },
      blocTotaux(totaux, null, p.devise_principale, { mixte, taux: t }),
      champ('Client', nom),
      zoneTel,
      listeClients,
      acompte.el,
      zoneModeAcompte,
      reste,
      mixte ? h('p', { class: 'champ-aide' }, 'Le client aura une dette en dollars et une dette en francs. Un acompte réduit la dette de sa devise.') : null,
      valider),
  });
  dessinerClients();
  majReste();
  if (!clients.length) nom.focus();
}

/* ---------- Reçu (ne montre jamais le prix d'achat) ---------- */

// Montant d'une ligne de reçu : « 32 $ » ou « 10 $ + 17 100 FC ».
const montantLigne = (l, v) => (l.devise === 'mixte' ? fmMontants(l.montants) : formater(l.quantite * l.prix_unitaire, l.devise ?? v.devise));

function texteRecu(d, p) {
  const v = d.vente;
  const L = [`*${p.nom_boutique}*`, `Reçu du ${dateNumerique(v.cree_le)} à ${heure(v.cree_le)}`, ''];
  for (const l of d.lignes) L.push(`${l.quantite} × ${l.nom} : ${montantLigne(l, v)}`);
  L.push('', `*Total : ${fmVente(v)}*`);
  if (v.statut === 'payee') {
    for (const e of d.encaissements.filter((x) => !x.annule_le)) L.push(`Payé (${modePaiement(e.mode)?.nom}) : ${formater(e.montant, e.devise)}`);
  } else {
    if (d.client) L.push(`Client : ${d.client.nom}`);
    if (d.acomptes.USD || d.acomptes.CDF) L.push(`Acompte versé : ${fmMulti(d.acomptes, v.devise)}`);
    L.push(`Reste à payer : ${fmMulti(d.reste, v.devise)}`);
  }
  if (v.annule_le) L.push('', 'VENTE ANNULÉE');
  L.push('', 'Merci pour votre achat !');
  return L.join('\n');
}

export async function ouvrirRecu(id, { nouvelle = false } = {}) {
  const [d, p] = await Promise.all([api.detailVente(id), api.profil()]);
  const v = d.vente;
  const pied = [];
  if (v.statut === 'payee') {
    for (const e of d.encaissements.filter((x) => !x.annule_le || v.annule_le)) {
      pied.push(h('div', { class: 'recu-ligne' }, h('span', {}, `Payé · ${modePaiement(e.mode)?.nom}`), h('span', {}, fm(e.montant, e.devise))));
    }
  } else {
    pied.push(h('div', { class: 'recu-ligne' }, h('span', {}, 'À crédit · client'), h('span', {}, d.client?.nom || '—')));
    if (d.acomptes.USD || d.acomptes.CDF) pied.push(h('div', { class: 'recu-ligne' }, h('span', {}, 'Acompte versé'), h('span', {}, fmMulti(d.acomptes, v.devise))));
    pied.push(h('div', { class: 'recu-ligne' }, h('strong', {}, 'Reste à payer'), h('strong', {}, fmMulti(d.reste, v.devise))));
  }

  // Bénéfice : visible uniquement pour le vendeur (jamais dans le texte partagé au client).
  const benefice = v.total_principal - (v.cout_principal || 0);
  const annulerBtn = !v.annule_le ? h('button', { class: 'btn-texte-danger' }, 'Annuler cette vente') : null;
  const f = ouvrirFeuille({
    titre: nouvelle ? 'Vente enregistrée' : 'Reçu',
    contenu: h('div', { class: 'pile' },
      h('div', { class: 'recu' },
        h('div', { class: 'recu-tete' },
          nouvelle ? h('span', { class: 'cachet-ok' }, icone('coche', 30)) : logo(p.nom_boutique, 48),
          h('strong', { class: 'sous-titre' }, p.nom_boutique),
          h('span', { class: 'texte-2' }, `${libelleJour(cleJour(v.cree_le))} · ${heure(v.cree_le)}`),
          v.annule_le ? h('span', { class: 'badge badge-zero' }, `Annulée à ${heure(v.annule_le)}`) : null),
        h('div', { class: `recu-lignes${v.annule_le ? ' barre-annule' : ''}` },
          ...d.lignes.map((l) => h('div', { class: 'recu-ligne' },
            h('span', {}, `${l.quantite} × ${l.nom}`),
            h('span', { class: 'num' }, montantLigne(l, v))))),
        h('div', { class: `recu-total${v.annule_le ? ' barre-annule' : ''}` }, h('span', {}, 'Total'), h('span', { class: 'num' }, fmVente(v))),
        h('div', { class: 'recu-pied' }, ...pied)),
      !v.annule_le ? h('p', { class: `champ-aide ${benefice < 0 ? 'negatif' : 'positif'}`, style: 'text-align:center' },
        `Pour toi seulement : bénéfice ${formater(benefice, p.devise_principale, { signe: true })}`) : null,
      h('button', { class: 'btn btn-principal btn-bloc', onclick: () => partager(texteRecu(d, p)) }, icone('partager', 20), 'Partager le reçu'),
      nouvelle ? h('button', { class: 'btn btn-secondaire btn-bloc', onclick: () => f.fermer() }, 'Nouvelle vente') : null,
      annulerBtn),
  });
  annulerBtn?.addEventListener('click', enCours(annulerBtn, async () => {
    const ok = await confirmer({
      titre: 'Annuler cette vente ?',
      message: 'Le stock sera remis et la caisse corrigée. La vente restera visible, barrée, dans l’historique.',
      ok: 'Annuler la vente', danger: true,
    });
    if (!ok) return;
    try { await api.annulerVente(id); f.fermer(); toast('Vente annulée. Le stock est remis.'); } catch (e) { erreur(e); }
  }));
  return f;
}

/* ---------- Taux du jour ---------- */

function feuilleTaux(p) {
  const champTaux = saisie({ inputmode: 'numeric', value: String(p.taux), 'aria-label': 'Nombre de francs pour 1 dollar' });
  const ok = h('button', { class: 'btn btn-principal btn-bloc btn-grand', type: 'button' }, 'Enregistrer');
  const f = ouvrirFeuille({
    titre: 'Taux du jour',
    contenu: h('form', { class: 'pile', onsubmit: (e) => { e.preventDefault(); ok.click(); } },
      champ('1 dollar = … francs', champTaux, 'Ce taux sert aux nouvelles ventes, paiements et dépenses. Les anciennes opérations gardent leur taux.'),
      ok),
  });
  ok.addEventListener('click', enCours(ok, async () => {
    const t = lireEntier(champTaux.value);
    if (!t) { champTaux.classList.add('invalide'); toast('Saisis un taux valide (ex. 2850).'); return; }
    try { await api.changerTaux(t); f.fermer(); toast(`Taux mis à jour : 1 $ = ${formater(t, 'CDF')}`); } catch (err) { erreur(err); }
  }));
  setTimeout(() => champTaux.select(), 250);
}

/* ---------- Historique des ventes ---------- */

export async function afficherHistorique(racine) {
  const ventes = await api.listerVentes();
  racine.append(enTete({ titre: 'Historique des ventes', retour: '#/vendre' }));
  if (!ventes.length) {
    racine.append(etatVide({ icone: 'historique', titre: 'Aucune vente', texte: 'Les ventes enregistrées apparaîtront ici.' }));
    return;
  }
  const jours = new Map();
  for (const x of ventes) {
    const c = cleJour(x.vente.cree_le);
    if (!jours.has(c)) jours.set(c, []);
    jours.get(c).push(x);
  }
  for (const [cle, liste] of jours) {
    racine.append(
      h('a', { class: 'groupe-titre', href: `#/rapports/${cle}` },
        h('span', { class: 'surtitre' }, libelleJour(cle)),
        h('span', { class: 'legende' }, 'Rapport du jour ›')),
      h('div', { class: 'liste' }, ...liste.map(({ vente: v, lignes, client }) => {
        const resume = lignes.map((l) => (l.quantite > 1 ? `${l.quantite} × ` : '') + l.nom).join(', ');
        return h('button', { class: 'liste-ligne', onclick: () => ouvrirRecu(v.id) },
          h('span', { class: 'liste-ligne-corps' },
            h('span', { class: `liste-ligne-titre${v.annule_le ? ' barre-annule' : ''}` }, resume),
            h('span', { class: 'liste-ligne-sous' }, `${heure(v.cree_le)}${client ? ' · ' + client.nom : ''}`)),
          h('span', { class: 'liste-ligne-fin' },
            h('span', { class: `liste-ligne-montant${v.annule_le ? ' barre-annule' : ''}` }, fmVente(v)),
            v.annule_le ? h('span', { class: 'badge badge-zero' }, 'Annulée')
              : v.statut === 'credit' ? h('span', { class: 'badge badge-accent' }, 'À crédit') : null));
      })));
  }
}
