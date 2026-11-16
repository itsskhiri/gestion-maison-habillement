// Écran ARTICLES : liste avec stock coloré, ajout rapide (nom, prix, quantité, catégorie facultative),
// nouvel arrivage, modification et suppression.

import * as api from './api.js';
import {
  h, icone, pastille, enTete, puces, saisie, champ, champMontant, ouvrirFeuille, confirmer,
  toast, erreur, vibrer, enCours, etatVide, vider,
} from './ui.js';
import { lireEntier, formater } from './money.js';
import { CATEGORIES } from './reference.js';

const etatEcran = { recherche: '', categorie: 'tout' };
// Mémorise les derniers choix pour enchaîner les ajouts plus vite.
const derniers = { devise: null, categorie: null };

const optionsCategories = () => CATEGORIES.map((c) => ({ id: c.id, libelle: c.nom, couleur: c.couleur }));

export function badgeStock(a, seuil) {
  if (a.quantite <= 0) return h('span', { class: 'badge badge-zero' }, 'Épuisé');
  if (a.quantite <= seuil) return h('span', { class: 'badge badge-bas' }, `${a.quantite} en stock`);
  return h('span', { class: 'badge badge-ok' }, `${a.quantite} en stock`);
}

export async function afficher(racine) {
  const [p, articles] = await Promise.all([api.profil(), api.listerArticles()]);
  const pieces = articles.reduce((s, a) => s + a.quantite, 0);
  racine.append(enTete({
    titre: 'Articles',
    sousTitre: articles.length ? `${articles.length} article${articles.length > 1 ? 's' : ''} · ${pieces} pièce${pieces > 1 ? 's' : ''} en stock` : null,
  }));

  const ajouter = h('button', { class: 'btn btn-principal btn-bloc btn-grand', onclick: () => ouvrirFormulaireArticle(p) }, icone('plus', 22), 'Ajouter un article');
  if (!articles.length) {
    racine.append(etatVide({
      icone: 'articles', titre: 'Ton stock est vide',
      texte: 'Un article, c’est juste un nom, un prix et une quantité. Par exemple « Robe rouge M ».',
      action: { libelle: 'Ajouter un article', icone: 'plus', onclick: () => ouvrirFormulaireArticle(p) },
    }));
    return;
  }

  const liste = h('div', { class: 'liste' });
  const presentes = CATEGORIES.filter((c) => articles.some((a) => a.categorie === c.id));
  const recherche = saisie({
    type: 'search', placeholder: 'Rechercher', value: etatEcran.recherche, enterkeyhint: 'search', 'aria-label': 'Rechercher un article',
    oninput: () => { etatEcran.recherche = recherche.value; dessiner(); },
  });
  if (!presentes.some((c) => c.id === etatEcran.categorie)) etatEcran.categorie = 'tout';

  racine.append(
    ajouter,
    h('div', { class: 'barre-outils', style: 'margin-top:16px' },
      h('div', { class: 'recherche' }, icone('recherche', 20), recherche),
      presentes.length ? puces([{ id: 'tout', libelle: 'Tout' }, ...presentes.map((c) => ({ id: c.id, libelle: c.nom, couleur: c.couleur }))],
        etatEcran.categorie, (c) => { etatEcran.categorie = c || 'tout'; dessiner(); }, { defilante: true, libelle: 'Catégories' }) : null),
    liste);

  function dessiner() {
    const q = etatEcran.recherche.trim().toLowerCase();
    const filtres = articles.filter((a) => (etatEcran.categorie === 'tout' || a.categorie === etatEcran.categorie)
      && (!q || a.nom.toLowerCase().includes(q)));
    vider(liste);
    if (!filtres.length) { liste.append(h('p', { class: 'liste-vide' }, 'Aucun article ne correspond.')); return; }
    liste.append(...filtres.map((a) => h('button', { class: 'liste-ligne', onclick: () => ouvrirArticle(p, a) },
      pastille(a.categorie, a.nom, 40),
      h('span', { class: 'liste-ligne-corps' },
        h('span', { class: 'liste-ligne-titre' }, a.nom),
        h('span', { class: 'liste-ligne-sous num' }, formater(a.prix, a.devise))),
      h('span', { class: 'liste-ligne-fin' }, badgeStock(a, p.seuil_stock_bas)),
      icone('droite', 20, 'chevron'))));
  }
  dessiner();
}

/* ---------- Ajout / modification ---------- */

function formulaire(p, article, { onValider, libelleBouton }) {
  let categorie = article ? article.categorie : derniers.categorie;
  const nom = saisie({ value: article?.nom ?? '', placeholder: 'Ex. Robe pagne wax M', maxlength: 80, 'aria-label': "Nom de l'article", enterkeyhint: 'next' });
  const prix = champMontant({ devise: article?.devise ?? derniers.devise ?? p.devise_principale, valeur: article?.prix ?? null, libelle: 'Prix de vente' });
  const quantite = article ? null : saisie({ inputmode: 'numeric', value: '1', 'aria-label': 'Quantité en stock', enterkeyhint: 'done' });
  const bouton = h('button', { class: 'btn btn-principal btn-bloc btn-grand', type: 'submit' }, libelleBouton);

  const form = h('form', { class: 'pile', novalidate: true },
    champ('Nom', nom, article ? null : 'Ajoute la taille ou la couleur dans le nom si besoin.'),
    prix.el,
    quantite ? champ('Quantité en stock', quantite) : null,
    h('div', { class: 'champ' },
      h('span', { class: 'champ-libelle' }, 'Catégorie (facultatif)'),
      puces(optionsCategories(), categorie, (c) => { categorie = c; }, { facultatif: true, libelle: 'Catégorie' })),
    bouton);

  nom.addEventListener('input', () => nom.classList.remove('invalide'));
  quantite?.addEventListener('input', () => quantite.classList.remove('invalide'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    enCours(bouton, async () => {
      try {
        if (!nom.value.trim()) { nom.classList.add('invalide'); nom.focus(); throw new api.ErreurMetier("Saisis le nom de l'article."); }
        const valeurPrix = prix.lire();
        if (!valeurPrix) { prix.signalerErreur(); throw new api.ErreurMetier('Saisis un prix valide.'); }
        const champs = { nom: nom.value, prix: valeurPrix, devise: prix.devise(), categorie };
        if (quantite) {
          const q = lireEntier(quantite.value);
          if (q == null) { quantite.classList.add('invalide'); quantite.focus(); throw new api.ErreurMetier('Saisis une quantité valide.'); }
          champs.quantite = q;
        }
        await onValider(champs);
      } catch (err) { erreur(err); }
    })();
  });
  return { form, focus: () => setTimeout(() => nom.focus(), 260) };
}

export function ouvrirFormulaireArticle(p) {
  let f = null;
  const nouveau = () => {
    const x = formulaire(p, null, {
      libelleBouton: 'Enregistrer',
      onValider: async (champs) => {
        const a = await api.ajouterArticle(champs);
        derniers.devise = champs.devise;
        derniers.categorie = champs.categorie;
        vibrer();
        f.titre('Article ajouté');
        f.remplacer(h('div', { class: 'pile', style: 'text-align:center;align-items:center' },
          h('span', { class: 'cachet-ok' }, icone('coche', 30)),
          h('p', { class: 'sous-titre' }, a.nom),
          h('p', { class: 'texte-2' }, `${formater(a.prix, a.devise)} · ${a.quantite} en stock`),
          h('button', { class: 'btn btn-principal btn-bloc btn-grand', onclick: () => { f.titre('Nouvel article'); nouveau(); } }, icone('plus', 22), 'Ajouter un autre'),
          h('button', { class: 'btn btn-secondaire btn-bloc', onclick: () => f.fermer() }, 'Terminer')));
      },
    });
    f.remplacer(x.form);
    x.focus();
  };
  f = ouvrirFeuille({ titre: 'Nouvel article', contenu: h('div') });
  nouveau();
}

function ouvrirArticle(p, a) {
  let delta = 0;
  const valeur = h('span', { class: 'stepper-valeur chiffre-m', 'aria-live': 'polite' }, '0');
  const apres = h('p', { class: 'champ-aide' });
  const moins = h('button', { class: 'btn-rond', type: 'button', 'aria-label': 'Retirer une pièce' }, icone('moins', 20));
  const plus = h('button', { class: 'btn-rond', type: 'button', 'aria-label': 'Ajouter une pièce' }, icone('plus', 20));
  const enregistrer = h('button', { class: 'btn btn-principal btn-bloc', type: 'button', disabled: true }, 'Enregistrer l’arrivage');
  const maj = () => {
    valeur.textContent = delta > 0 ? `+${delta}` : String(delta);
    moins.disabled = a.quantite + delta <= 0;
    enregistrer.disabled = delta === 0;
    enregistrer.textContent = delta < 0 ? 'Corriger le stock' : 'Enregistrer l’arrivage';
    apres.textContent = delta ? `Nouveau stock : ${a.quantite + delta}` : 'Touche + pour ajouter les pièces reçues.';
  };
  moins.onclick = () => { delta--; maj(); };
  plus.onclick = () => { delta++; maj(); };
  enregistrer.addEventListener('click', enCours(enregistrer, async () => {
    try {
      const r = await api.ajusterStock(a.id, delta);
      vibrer();
      toast(`Stock de « ${r.nom} » : ${r.quantite}`);
      f.fermer();
    } catch (e) { erreur(e); }
  }));

  const modif = formulaire(p, a, {
    libelleBouton: 'Enregistrer les modifications',
    onValider: async (champs) => {
      await api.modifierArticle(a.id, champs);
      toast('Article modifié');
      f.fermer();
    },
  });

  const supprimer = h('button', { class: 'btn-texte-danger', type: 'button' }, icone('corbeille', 20), ' Supprimer cet article');
  supprimer.addEventListener('click', enCours(supprimer, async () => {
    const ok = await confirmer({
      titre: `Supprimer « ${a.nom} » ?`,
      message: 'Il disparaîtra de la liste. Les anciennes ventes et les rapports ne changent pas.',
      ok: 'Supprimer', danger: true,
    });
    if (!ok) return;
    try { await api.supprimerArticle(a.id); toast('Article supprimé'); f.fermer(); } catch (e) { erreur(e); }
  }));

  const f = ouvrirFeuille({
    titre: a.nom,
    contenu: h('div', { class: 'pile' },
      h('div', { class: 'carte' },
        h('div', { class: 'rangee-espace' },
          h('div', {},
            h('p', { class: 'legende' }, 'En stock'),
            h('p', { class: `chiffre-l ${a.quantite <= 0 ? 'negatif' : a.quantite <= p.seuil_stock_bas ? 'attention' : 'positif'}` }, String(a.quantite))),
          h('div', { class: 'stepper' }, moins, valeur, plus)),
        h('p', { class: 'sous-titre', style: 'font-size:17px;margin-top:8px' }, 'Nouvel arrivage'),
        apres,
        h('div', { style: 'margin-top:12px' }, enregistrer)),
      h('p', { class: 'surtitre', style: 'margin-top:8px' }, 'Modifier'),
      modif.form,
      supprimer),
  });
  maj();
}
