// Écran VENDRE : grille d'articles, panier, paiement (cash / Mobile Money, $ / FC / les deux),
// vente à crédit avec acompte, reçu à partager, annulation, historique des ventes.

import * as api from './api.js';
import {
  h, icone, logo, pastille, boutonProfil, enTete, fm, num, puces, segment, saisie, champ, champMontant,
  ouvrirFeuille, confirmer, toast, erreur, vibrer, partager, enCours, etatVide, optionsModes, vider,
} from './ui.js';
import { convertir, formater, lireMontant, lireEntier, versSaisie, autreDevise, toleranceConversion } from './money.js';
import { CATEGORIES, modePaiement } from './reference.js';
import { aujourdhui, heure, cleJour, libelleJour, dateNumerique } from './temps.js';
import { ouvrirFormulaireArticle } from './articles.js';

// État de l'écran conservé entre deux affichages (le panier ne se vide pas en changeant d'onglet).
const etatEcran = {
  panier: new Map(),   // article_id -> { quantite, prix: null | prix unitaire modifié (devise de la vente) }
  recherche: '',
  categorie: 'tout',
  devise: null,        // devise de la vente
  taux: null,          // taux modifié pour cette vente seulement (sinon taux de la boutique)
};

export async function afficher(racine) {
  const [p, articles, stats] = await Promise.all([
    api.profil(), api.listerArticles(), api.statsPeriode(aujourdhui(), aujourdhui()),
  ]);
  etatEcran.devise ??= p.devise_principale;
  const parId = new Map(articles.map((a) => [a.id, a]));
  for (const [id, x] of etatEcran.panier) {
    const a = parId.get(id);
    if (!a || a.quantite <= 0) etatEcran.panier.delete(id);
    else if (x.quantite > a.quantite) x.quantite = a.quantite;
  }
  const ctx = { p, parId, taux: () => etatEcran.taux ?? p.taux };

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
        h('span', { class: 'texte-2' }, 'Encaissé ', num(fm(stats.encaisse, p.devise_principale)),
          ` · ${stats.nbVentes} vente${stats.nbVentes > 1 ? 's' : ''}`),
        h('button', { class: 'puce-taux', onclick: () => feuilleTaux(p), 'aria-label': 'Modifier le taux du jour' },
          `1 $ = ${formater(p.taux, 'CDF')}`, icone('crayon', 14)))),
  );

  if (!articles.length) {
    racine.append(etatVide({
      icone: 'articles', titre: 'Aucun article pour l’instant',
      texte: 'Ajoute tes robes, jeans, chaussures… avec leur prix et leur stock pour commencer à vendre.',
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
      'aria-label': `${a.nom}, ${formater(a.prix, a.devise)}${epuise ? ', épuisé' : `, stock ${a.quantite}`}${dansPanier ? `, ${dansPanier} dans le panier` : ''}`,
      'aria-disabled': epuise ? 'true' : null,
      onclick: () => ajouter(a),
    },
    pastille(a.categorie, a.nom, 32),
    h('span', { class: 'carte-article-nom' }, a.nom),
    h('div', { class: 'carte-article-pied' },
      h('span', { class: 'carte-article-prix' }, formater(a.prix, a.devise)),
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
        h('span', { class: 'barre-panier-total' }, fm(lignes.reduce((s, l) => s + l.total, 0), etatEcran.devise))));
  }
  function majTout() { dessinerGrille(); majBarre(); }

  dessinerGrille();
  majBarre();
}

// Lignes du panier avec le prix unitaire dans la devise de la vente.
function lignesPanier(ctx) {
  return [...etatEcran.panier].filter(([id]) => ctx.parId.has(id)).map(([id, x]) => {
    const a = ctx.parId.get(id);
    const pu = x.prix ?? convertir(a.prix, a.devise, etatEcran.devise, ctx.taux());
    return { a, quantite: x.quantite, pu, total: pu * x.quantite };
  });
}

/* ---------- Panier ---------- */

function feuillePanier(ctx, majEcran) {
  let f = null;
  const rafraichir = () => {
    majEcran();
    if (!etatEcran.panier.size) { f.fermer(); return; }
    f.remplacer(contenu());
  };

  function contenu() {
    const lignes = lignesPanier(ctx);
    const total = lignes.reduce((s, l) => s + l.total, 0);
    const champTaux = saisie({ inputmode: 'numeric', value: String(ctx.taux()), style: 'max-width:140px', 'aria-label': 'Taux pour cette vente' });
    champTaux.addEventListener('change', () => {
      const t = lireEntier(champTaux.value);
      if (!t) { toast('Taux invalide.'); champTaux.value = String(ctx.taux()); return; }
      etatEcran.taux = t === ctx.p.taux ? null : t;
      for (const x of etatEcran.panier.values()) x.prix = null; // prix recalculés au nouveau taux
      rafraichir();
    });

    return h('div', { class: 'pile' },
      h('div', { class: 'rangee-espace' },
        h('span', { class: 'champ-libelle' }, 'Vendre en'),
        h('div', { style: 'width:160px' }, segment([{ id: 'USD', libelle: 'Dollar' }, { id: 'CDF', libelle: 'Franc' }], etatEcran.devise, (d) => {
          for (const x of etatEcran.panier.values()) {
            if (x.prix != null) x.prix = convertir(x.prix, etatEcran.devise, d, ctx.taux());
          }
          etatEcran.devise = d;
          rafraichir();
        }, { libelle: 'Devise de la vente' }))),
      h('div', { class: 'rangee-espace' },
        h('span', { class: 'champ-libelle' }, 'Taux pour cette vente'),
        h('div', { class: 'rangee' }, h('span', { class: 'texte-2' }, '1 $ ='), champTaux, h('span', { class: 'texte-2' }, 'FC'))),
      h('div', {},
        ...lignes.map((l) => {
          const x = etatEcran.panier.get(l.a.id);
          const prix = saisie({ inputmode: etatEcran.devise === 'USD' ? 'decimal' : 'numeric', value: versSaisie(l.pu, etatEcran.devise), 'aria-label': `Prix de ${l.a.nom}` });
          prix.addEventListener('change', () => {
            const v = lireMontant(prix.value, etatEcran.devise);
            if (v == null) { toast('Prix invalide.'); prix.value = versSaisie(l.pu, etatEcran.devise); return; }
            x.prix = v;
            rafraichir();
          });
          const moins = h('button', { class: 'btn-rond', 'aria-label': 'Retirer un', onclick: () => {
            x.quantite--;
            if (x.quantite <= 0) etatEcran.panier.delete(l.a.id);
            rafraichir();
          } }, icone(x.quantite > 1 ? 'moins' : 'corbeille', 20));
          const plus = h('button', { class: 'btn-rond', 'aria-label': 'Ajouter un', disabled: x.quantite >= l.a.quantite, onclick: () => { x.quantite++; rafraichir(); } }, icone('plus', 20));
          return h('div', { class: 'ligne-panier' },
            h('div', { class: 'ligne-panier-tete' },
              h('span', { class: 'ligne-panier-nom' }, l.a.nom),
              h('span', { class: 'num', style: 'font-weight:600' }, fm(l.total, etatEcran.devise))),
            h('div', { class: 'rangee-espace' },
              h('label', { class: 'prix-modifiable' }, prix, h('span', { class: 'texte-2' }, etatEcran.devise === 'USD' ? '$ / pièce' : 'FC / pièce')),
              h('div', { class: 'stepper' }, moins, h('span', { class: 'stepper-valeur', 'aria-live': 'polite' }, String(x.quantite)), plus)));
        })),
      h('div', { class: 'total-panier' },
        h('span', { class: 'sous-titre' }, 'Total'),
        h('span', { class: 'chiffre-l' }, fm(total, etatEcran.devise))),
      h('button', { class: 'btn btn-principal btn-grand btn-bloc', onclick: () => { f.fermer(); feuillePaiement(ctx); } }, 'Valider la vente'),
      h('button', { class: 'btn-texte-danger', onclick: () => { etatEcran.panier.clear(); etatEcran.taux = null; rafraichir(); } }, 'Vider le panier'));
  }

  f = ouvrirFeuille({ titre: 'Panier', contenu: h('div') });
  f.remplacer(contenu());
}

/* ---------- Paiement ---------- */

function feuillePaiement(ctx) {
  const lignes = lignesPanier(ctx);
  if (!lignes.length) return;
  const dev = etatEcran.devise;
  const t = ctx.taux();
  const total = lignes.reduce((s, l) => s + l.total, 0);
  const autre = autreDevise(dev);
  const equivalent = convertir(total, dev, autre, t);
  let mode = 'cash';
  let recu = dev;

  const totalUSD = convertir(total, dev, 'USD', t);
  // Paiement mélangé : deux champs. Quand on remplit l'un, l'autre se complète avec le reste ;
  // les deux restent modifiables et un message dit si le compte est bon.
  const totalFC = convertir(total, dev, 'CDF', t);
  const bilanMixte = h('p', { class: 'champ-aide', 'aria-live': 'polite' });
  const partieUSD = champMontant({ devise: 'USD', libelle: 'Combien en dollars ?', avecDevise: false, onSaisie: () => completer('USD') });
  const partieFC = champMontant({ devise: 'CDF', libelle: 'Combien en francs ?', avecDevise: false, onSaisie: () => completer('CDF') });
  const zoneMixte = h('div', { class: 'pile-serree', hidden: true },
    h('div', { class: 'duo duo-montants' }, partieUSD.el, partieFC.el), bilanMixte);

  // Un champ rempli à la main n'est plus jamais réécrit automatiquement (sauf si on le vide).
  const saisiMain = { USD: false, CDF: false };
  function completer(source) {
    const champSource = source === 'USD' ? partieUSD : partieFC;
    saisiMain[source] = champSource.entree.value.trim() !== '';
    if (source === 'USD' && !saisiMain.CDF) {
      const u = partieUSD.lire();
      partieFC.definir(u && u < totalUSD ? (dev === 'USD' ? convertir(total - u, 'USD', 'CDF', t) : total - convertir(u, 'USD', 'CDF', t)) : null);
    } else if (source === 'CDF' && !saisiMain.USD) {
      const fc = partieFC.lire();
      partieUSD.definir(fc && fc < totalFC ? (dev === 'USD' ? total - convertir(fc, 'CDF', 'USD', t) : convertir(total - fc, 'CDF', 'USD', t)) : null);
    }
    majBilan();
  }

  // Écart entre ce qui est reçu et le total (dans la devise de la vente), et marge d'arrondi permise.
  function ecartMixte() {
    const u = partieUSD.lire() || 0;
    const fc = partieFC.lire() || 0;
    const recuTotal = convertir(u, 'USD', dev, t) + convertir(fc, 'CDF', dev, t);
    const marge = (u && dev !== 'USD' ? toleranceConversion('USD', dev, t) : 0) + (fc && dev !== 'CDF' ? toleranceConversion('CDF', dev, t) : 0);
    return { u, fc, ecart: recuTotal - total, marge };
  }

  function majBilan() {
    const { u, fc, ecart, marge } = ecartMixte();
    if (!u && !fc) { bilanMixte.textContent = ''; return; }
    if (Math.abs(ecart) <= marge) {
      bilanMixte.className = 'champ-aide positif';
      bilanMixte.textContent = `Le compte est bon : ${formater(u, 'USD')} + ${formater(fc, 'CDF')} = ${formater(total, dev)}`;
    } else if (ecart < 0) {
      bilanMixte.className = 'champ-aide negatif';
      bilanMixte.textContent = `Il manque ${formater(-ecart, dev)}`;
    } else {
      bilanMixte.className = 'champ-aide attention';
      bilanMixte.textContent = `C'est ${formater(ecart, dev)} de trop`;
    }
  }

  function encaissements() {
    if (recu === dev) return [{ devise: dev, montant: total, mode }];
    if (recu === autre) return [{ devise: autre, montant: equivalent, mode }];
    const { u, fc, ecart, marge } = ecartMixte();
    if (!u) { partieUSD.signalerErreur(); throw new api.ErreurMetier('Saisis combien le client paie en dollars.'); }
    if (!fc) { partieFC.signalerErreur(); throw new api.ErreurMetier('Saisis combien le client paie en francs.'); }
    if (Math.abs(ecart) > marge) {
      throw new api.ErreurMetier(ecart < 0 ? `Il manque ${formater(-ecart, dev)} pour payer le total.` : `C'est ${formater(ecart, dev)} de trop : corrige les montants.`);
    }
    return [{ devise: 'USD', montant: u, mode }, { devise: 'CDF', montant: fc, mode }];
  }

  // Ce que le client doit donner, selon la devise choisie (montre clairement le choix fait).
  const aPayer = h('div', { class: 'a-payer', 'aria-live': 'polite' });
  function majAPayer() {
    aPayer.hidden = recu === 'mixte';
    if (recu === 'mixte') return;
    aPayer.replaceChildren(
      h('span', { class: 'texte-2' }, 'Le client donne'),
      h('strong', { class: 'chiffre-m' }, fm(recu === dev ? total : equivalent, recu)));
  }
  majAPayer();

  const payer = h('button', { class: 'btn btn-principal btn-grand btn-bloc' }, icone('coche', 22), 'Payé');
  payer.addEventListener('click', enCours(payer, async () => {
    try {
      await enregistrerVente(ctx, { type: 'payee', encaissements: encaissements() }, f);
    } catch (e) { erreur(e); }
  }));

  const f = ouvrirFeuille({
    titre: 'Paiement',
    contenu: h('div', { class: 'pile' },
      h('div', { class: 'recu-total', style: 'padding:0;flex-direction:column;align-items:flex-start;gap:2px' },
        h('span', { class: 'legende' }, 'Total à payer'),
        h('span', { class: 'chiffre-l' }, fm(total, dev)),
        h('span', { class: 'texte-2', style: 'font-size:15px;font-weight:500' }, `soit ${fm(equivalent, autre)} au taux de ${formater(t, 'CDF')}`)),
      h('div', { class: 'champ' },
        h('span', { class: 'champ-libelle' }, 'Mode de paiement'),
        puces(optionsModes(), mode, (m) => { mode = m || 'cash'; }, { libelle: 'Mode de paiement' })),
      h('div', { class: 'champ' },
        h('span', { class: 'champ-libelle' }, 'Reçu en'),
        segment([{ id: 'USD', libelle: 'Dollars' }, { id: 'CDF', libelle: 'Francs' }, { id: 'mixte', libelle: '$ + FC' }], recu, (r) => {
          recu = r;
          zoneMixte.hidden = r !== 'mixte';
          majAPayer();
          if (r === 'mixte') partieUSD.entree.focus();
        }, { libelle: 'Devise reçue' })),
      aPayer,
      zoneMixte,
      payer,
      h('button', { class: 'btn btn-secondaire btn-grand btn-bloc', onclick: () => { f.fermer(); feuilleCredit(ctx, total); } }, 'À crédit')),
  });
}

async function enregistrerVente(ctx, paiement, feuille) {
  const lignes = lignesPanier(ctx);
  const entree = {
    devise: etatEcran.devise,
    taux: ctx.taux(),
    lignes: lignes.map((l) => ({ article_id: l.a.id, quantite: l.quantite, prix_unitaire: l.pu })),
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

/* ---------- Vente à crédit ---------- */

async function feuilleCredit(ctx, total) {
  const dev = etatEcran.devise;
  const t = ctx.taux();
  const clients = await api.listerClients();
  let choisi = null; // id d'un client existant
  let modeAcompte = 'cash';

  const nom = saisie({ placeholder: 'Nom du client', autocapitalize: 'words', maxlength: 60, 'aria-label': 'Nom du client' });
  const telephone = saisie({ type: 'tel', inputmode: 'tel', placeholder: 'Téléphone (facultatif)', maxlength: 20, 'aria-label': 'Téléphone du client' });
  const zoneTel = h('div', { hidden: true }, telephone);
  const listeClients = h('div', { class: 'choix-client', role: 'list' });
  const reste = h('p', { class: 'texte-2' });
  const acompte = champMontant({ devise: dev, libelle: 'Acompte payé maintenant (facultatif)', onSaisie: majReste });
  const zoneModeAcompte = h('div', { class: 'champ', hidden: true },
    h('span', { class: 'champ-libelle' }, 'Acompte reçu par'),
    puces(optionsModes(), modeAcompte, (m) => { modeAcompte = m || 'cash'; }, { libelle: 'Mode de paiement de l’acompte' }));

  function majReste() {
    const a = acompte.lire();
    const contre = a ? convertir(a, acompte.devise(), dev, t) : 0;
    zoneModeAcompte.hidden = !a;
    reste.replaceChildren('Reste à crédit : ', h('strong', { class: 'num' }, fm(Math.max(0, total - contre), dev)));
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
      h('div', { class: 'rangee-espace' },
        h('span', { class: 'texte-2' }, 'Total de la vente'),
        h('span', { class: 'chiffre-m' }, fm(total, dev))),
      champ('Client', nom),
      zoneTel,
      listeClients,
      acompte.el,
      zoneModeAcompte,
      reste,
      valider),
  });
  dessinerClients();
  majReste();
  if (!clients.length) nom.focus();
}

/* ---------- Reçu ---------- */

function texteRecu(d, p) {
  const v = d.vente;
  const L = [`*${p.nom_boutique}*`, `Reçu du ${dateNumerique(v.cree_le)} à ${heure(v.cree_le)}`, ''];
  for (const l of d.lignes) L.push(`${l.quantite} × ${l.nom} : ${formater(l.quantite * l.prix_unitaire, v.devise)}`);
  L.push('', `*Total : ${formater(v.total, v.devise)}*`);
  if (v.statut === 'payee') {
    for (const e of d.encaissements.filter((x) => !x.annule_le)) L.push(`Payé (${modePaiement(e.mode)?.nom}) : ${formater(e.montant, e.devise)}`);
  } else {
    if (d.client) L.push(`Client : ${d.client.nom}`);
    if (d.dette?.acompte) L.push(`Acompte versé : ${formater(d.dette.acompte, v.devise)}`);
    L.push(`Reste à payer : ${formater(d.reste, v.devise)}`);
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
    if (d.dette?.acompte) pied.push(h('div', { class: 'recu-ligne' }, h('span', {}, 'Acompte versé'), h('span', {}, fm(d.dette.acompte, v.devise))));
    pied.push(h('div', { class: 'recu-ligne' }, h('strong', {}, 'Reste à payer'), h('strong', {}, fm(d.reste, v.devise))));
  }
  if (v.taux) pied.push(h('div', { class: 'recu-ligne' }, h('span', {}, 'Taux'), h('span', {}, `1 $ = ${formater(v.taux, 'CDF')}`)));

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
            h('span', {}, fm(l.quantite * l.prix_unitaire, v.devise))))),
        h('div', { class: `recu-total${v.annule_le ? ' barre-annule' : ''}` }, h('span', {}, 'Total'), h('span', { class: 'num' }, fm(v.total, v.devise))),
        h('div', { class: 'recu-pied' }, ...pied)),
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
            h('span', { class: `liste-ligne-montant${v.annule_le ? ' barre-annule' : ''}` }, fm(v.total, v.devise)),
            v.annule_le ? h('span', { class: 'badge badge-zero' }, 'Annulée')
              : v.statut === 'credit' ? h('span', { class: 'badge badge-accent' }, 'À crédit') : null));
      })));
  }
}
