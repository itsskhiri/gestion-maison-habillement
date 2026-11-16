// Écran DÉPENSES : total du mois, nouvelle dépense (montant + type en gros boutons),
// modification et annulation. Chaque dépense sort de la caisse.

import * as api from './api.js';
import {
  h, icone, enTete, fm, puces, saisie, champMontant, ouvrirFeuille, confirmer, toast, erreur,
  vibrer, enCours, etatVide, optionsModes,
} from './ui.js';
import { formater } from './money.js';
import { TYPES_DEPENSE, typeDepense, modePaiement } from './reference.js';
import { aujourdhui, cleJour, heure, libelleJour, libelleMois } from './temps.js';

export const ICONE_TYPE = { marchandise: 'articles', loyer: 'maison', transport: 'camion', energie: 'eclair', salaire: 'profil', autre: 'depenses' };

export async function afficher(racine) {
  const p = await api.profil();
  const jour = aujourdhui();
  const debutMois = jour.slice(0, 7) + '-01';
  const [stats, depenses] = await Promise.all([api.statsPeriode(debutMois, jour), api.listerDepenses('0000-01-01', jour)]);

  racine.append(enTete({ titre: 'Dépenses' }));
  racine.append(h('section', { class: 'grand-total' },
    h('p', { class: 'legende' }, `Dépenses de ${libelleMois(jour.slice(0, 7)).toLowerCase()}`),
    h('p', { class: 'chiffre-xl negatif' }, fm(stats.depenses, p.devise_principale))));
  racine.append(h('button', { class: 'btn btn-principal btn-bloc btn-grand', onclick: () => ouvrirFormulaireDepense(p) }, icone('plus', 22), 'Nouvelle dépense'));

  if (!depenses.length) {
    racine.append(etatVide({ icone: 'depenses', titre: 'Aucune dépense', texte: 'Loyer, transport, achat de marchandise… note-les ici pour connaître ton vrai bénéfice.' }));
    return;
  }

  const jours = new Map();
  for (const d of depenses) {
    const c = cleJour(d.cree_le);
    if (!jours.has(c)) jours.set(c, []);
    jours.get(c).push(d);
  }
  const zone = h('div', { style: 'margin-top:24px' });
  for (const [cle, liste] of jours) {
    zone.append(
      h('a', { class: 'groupe-titre', href: `#/rapports/${cle}` },
        h('span', { class: 'surtitre' }, libelleJour(cle)),
        h('span', { class: 'legende num' }, fm(liste.filter((d) => !d.annule_le).reduce((s, d) => s + d.montant_principal, 0), p.devise_principale))),
      h('div', { class: 'liste' }, ...liste.map((d) => ligneDepense(p, d))));
  }
  racine.append(zone);
}

export function ligneDepense(p, d, { avecHeure = true } = {}) {
  const t = typeDepense(d.type);
  return h('button', { class: 'liste-ligne', onclick: () => ouvrirFormulaireDepense(p, d) },
    h('span', { class: 'icone-ronde negatif' }, icone(ICONE_TYPE[d.type] || 'depenses', 20)),
    h('span', { class: 'liste-ligne-corps' },
      h('span', { class: `liste-ligne-titre${d.annule_le ? ' barre-annule' : ''}` }, t.nom),
      h('span', { class: 'liste-ligne-sous' }, [avecHeure ? heure(d.cree_le) : null, modePaiement(d.mode)?.nom, d.note].filter(Boolean).join(' · '))),
    h('span', { class: 'liste-ligne-fin' },
      h('span', { class: `liste-ligne-montant ${d.annule_le ? 'barre-annule' : 'negatif'}` }, fm(-d.montant, d.devise)),
      d.annule_le ? h('span', { class: 'badge badge-zero' }, 'Annulée') : null));
}

export async function ouvrirDepense(id) {
  const [p, d] = await Promise.all([api.profil(), api.depense(id)]);
  if (d) ouvrirFormulaireDepense(p, d);
}

export function ouvrirFormulaireDepense(p, depense = null) {
  if (depense?.annule_le) {
    ouvrirFeuille({
      titre: typeDepense(depense.type).nom,
      contenu: h('div', { class: 'pile' },
        h('p', { class: 'chiffre-l barre-annule' }, fm(depense.montant, depense.devise)),
        h('p', { class: 'texte-2' }, `Dépense annulée le ${libelleJour(cleJour(depense.annule_le)).toLowerCase()} à ${heure(depense.annule_le)}. Elle ne compte plus dans la caisse.`)),
    });
    return;
  }
  let type = depense?.type ?? null;
  let mode = depense?.mode ?? 'cash';
  const montant = champMontant({ devise: depense?.devise ?? p.devise_principale, valeur: depense?.montant ?? null, libelle: 'Montant' });
  const note = saisie({ placeholder: 'Note (facultatif)', value: depense?.note ?? '', maxlength: 120, 'aria-label': 'Note' });
  const choixType = puces(TYPES_DEPENSE.map((t) => ({ id: t.id, libelle: t.nom })), type, (t) => { type = t; choixType.classList.remove('invalide'); }, { grandes: true, libelle: 'Type de dépense' });

  const enregistrer = h('button', { class: 'btn btn-principal btn-bloc btn-grand' }, depense ? 'Enregistrer les modifications' : 'Enregistrer la dépense');
  enregistrer.addEventListener('click', enCours(enregistrer, async () => {
    try {
      const m = montant.lire();
      if (!m) { montant.signalerErreur(); throw new api.ErreurMetier('Saisis le montant de la dépense.'); }
      if (!type) throw new api.ErreurMetier('Choisis le type de dépense.');
      const champs = { montant: m, devise: montant.devise(), type, mode, note: note.value };
      if (depense) await api.modifierDepense(depense.id, champs);
      else await api.ajouterDepense(champs);
      vibrer();
      toast(`${depense ? 'Dépense modifiée' : 'Dépense enregistrée'} : ${formater(m, montant.devise())}`);
      f.fermer();
    } catch (e) { erreur(e); }
  }));

  const annuler = depense ? h('button', { class: 'btn-texte-danger' }, 'Annuler cette dépense') : null;
  annuler?.addEventListener('click', enCours(annuler, async () => {
    const ok = await confirmer({
      titre: 'Annuler cette dépense ?', message: 'Le montant sera remis dans la caisse. La dépense restera visible, barrée.',
      ok: 'Annuler la dépense', danger: true,
    });
    if (!ok) return;
    try { await api.annulerDepense(depense.id); toast('Dépense annulée'); f.fermer(); } catch (e) { erreur(e); }
  }));

  const f = ouvrirFeuille({
    titre: depense ? 'Modifier la dépense' : 'Nouvelle dépense',
    contenu: h('div', { class: 'pile' },
      montant.el,
      h('div', { class: 'champ' }, h('span', { class: 'champ-libelle' }, 'Type'), choixType),
      h('div', { class: 'champ' }, h('span', { class: 'champ-libelle' }, 'Payé par'),
        puces(optionsModes(), mode, (x) => { mode = x || 'cash'; }, { libelle: 'Mode de paiement' })),
      note,
      enregistrer,
      annuler),
  });
  if (!depense) setTimeout(() => montant.entree.focus(), 260);
}
