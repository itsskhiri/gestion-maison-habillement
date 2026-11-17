// Impression et PDF des factures, sans librairie : on prépare une page propre et on ouvre la
// fenêtre d'impression du téléphone ou de l'ordinateur. Sur iPhone : « Imprimer » puis
// partager / enregistrer en PDF ; sur ordinateur : « Enregistrer au format PDF ».
// Le prix d'achat et le bénéfice n'apparaissent JAMAIS sur ces documents.

import { h, icone } from './ui.js';
import { formater, formaterMulti } from './money.js';
import { modePaiement } from './reference.js';
import { heure, libelleJour, dateNumerique, aujourdhui } from './temps.js';

const montantLigne = (l, v) => (l.devise === 'mixte'
  ? ['USD', 'CDF'].filter((d) => l.montants[d]).map((d) => formater(l.montants[d], d)).join(' + ')
  : formater(l.quantite * l.prix_unitaire, l.devise ?? v.devise));

const totalVente = (v) => (v.totaux && v.totaux.USD > 0 && v.totaux.CDF > 0
  ? `${formater(v.totaux.USD, 'USD')} + ${formater(v.totaux.CDF, 'CDF')}`
  : formater(v.total, v.devise));

function entete(p, titre, sousTitre) {
  return h('header', { class: 'imp-entete' },
    h('div', {},
      h('div', { class: 'imp-boutique' }, p.nom_boutique),
      h('div', { class: 'imp-petit' }, 'Maison d’habillement')),
    h('div', { class: 'imp-titre-bloc' },
      h('div', { class: 'imp-titre' }, titre),
      sousTitre ? h('div', { class: 'imp-petit' }, sousTitre) : null));
}

// Ouvre la fenêtre d'impression pour un contenu donné. `nom` devient le nom du fichier PDF.
function lancer(contenu, nom) {
  document.getElementById('zone-impression')?.remove();
  const zone = h('div', { id: 'zone-impression' }, contenu);
  document.body.append(zone);
  const titreAvant = document.title;
  document.title = nom;
  const nettoyer = () => { document.title = titreAvant; zone.remove(); window.removeEventListener('afterprint', nettoyer); };
  window.addEventListener('afterprint', nettoyer);
  // Laisse le navigateur dessiner la zone avant d'ouvrir la fenêtre d'impression.
  setTimeout(() => { window.print(); setTimeout(() => { if (document.title === nom) nettoyer(); }, 60000); }, 50);
}

/* ---------- Une facture ---------- */

export function documentFacture(d, p) {
  const v = d.vente;
  const pied = [];
  if (v.statut === 'payee') {
    for (const e of d.encaissements.filter((x) => !x.annule_le || v.annule_le)) {
      pied.push(h('tr', {}, h('td', {}, `Payé · ${modePaiement(e.mode)?.nom ?? ''}`), h('td', { class: 'imp-droite' }, formater(e.montant, e.devise))));
    }
  } else {
    if (d.acomptes.USD || d.acomptes.CDF) pied.push(h('tr', {}, h('td', {}, 'Acompte versé'), h('td', { class: 'imp-droite' }, formaterMulti(d.acomptes, v.devise))));
    pied.push(h('tr', { class: 'imp-fort' }, h('td', {}, 'Reste à payer'), h('td', { class: 'imp-droite' }, formaterMulti(d.reste, v.devise))));
  }
  return h('article', { class: 'imp-page' },
    entete(p, `Facture n° ${v.numero}`, `${dateNumerique(v.cree_le)} à ${heure(v.cree_le)}`),
    v.annule_le ? h('div', { class: 'imp-annule' }, `FACTURE ANNULÉE le ${dateNumerique(v.annule_le)} à ${heure(v.annule_le)}`) : null,
    h('div', { class: 'imp-infos' },
      h('div', {}, h('span', { class: 'imp-petit' }, 'Client'), h('div', {}, d.client?.nom || 'Client de passage'),
        d.client?.telephone ? h('div', { class: 'imp-petit' }, d.client.telephone) : null),
      h('div', { class: 'imp-droite' }, h('span', { class: 'imp-petit' }, 'Paiement'),
        h('div', {}, v.statut === 'credit' ? 'À crédit' : 'Payée'))),
    h('table', { class: 'imp-table' },
      h('thead', {}, h('tr', {}, h('th', { style: 'width:12%' }, 'Qté'), h('th', {}, 'Article'), h('th', { class: 'imp-droite' }, 'Montant'))),
      h('tbody', {}, ...d.lignes.map((l) => h('tr', {},
        h('td', {}, String(l.quantite)), h('td', {}, l.nom), h('td', { class: 'imp-droite' }, montantLigne(l, v))))),
      h('tfoot', {},
        h('tr', { class: 'imp-total' }, h('td', { colspan: 2 }, 'Total'), h('td', { class: 'imp-droite' }, totalVente(v))))),
    h('table', { class: 'imp-table imp-pied' }, h('tbody', {}, ...pied)),
    v.taux ? h('p', { class: 'imp-petit' }, `Taux appliqué : 1 $ = ${formater(v.taux, 'CDF')}`) : null,
    h('p', { class: 'imp-merci' }, 'Merci pour votre achat !'));
}

export function imprimerFacture(d, p) {
  lancer(documentFacture(d, p), `Facture ${d.vente.numero} - ${p.nom_boutique}`);
}

/* ---------- Liste des factures d'une période ---------- */

export function imprimerListe({ p, titre, debut, fin, liste, resume }) {
  const periode = debut === fin ? libelleJour(debut, { annee: true }) : `Du ${dateNumerique(debut + 'T12:00:00Z')} au ${dateNumerique(fin + 'T12:00:00Z')}`;
  const doc = h('article', { class: 'imp-page' },
    entete(p, `Factures : ${titre}`, periode),
    h('div', { class: 'imp-infos' },
      h('div', {}, h('span', { class: 'imp-petit' }, 'Nombre de factures'), h('div', {}, String(resume.nombre))),
      h('div', {}, h('span', { class: 'imp-petit' }, 'Payées / à crédit'), h('div', {}, `${resume.payees} / ${resume.credit}`)),
      h('div', { class: 'imp-droite' }, h('span', { class: 'imp-petit' }, 'Total'), h('div', { class: 'imp-fort' }, formaterMulti(resume.totaux, p.devise_principale)))),
    h('table', { class: 'imp-table' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'N°'), h('th', {}, 'Date'), h('th', {}, 'Client'), h('th', {}, 'Statut'), h('th', { class: 'imp-droite' }, 'Montant'))),
      h('tbody', {}, ...liste.slice().reverse().map(({ vente: v, client }) => h('tr', { class: v.annule_le ? 'imp-barre' : '' },
        h('td', {}, String(v.numero)),
        h('td', {}, `${dateNumerique(v.cree_le)} ${heure(v.cree_le)}`),
        h('td', {}, client?.nom || '—'),
        h('td', {}, v.annule_le ? 'Annulée' : v.statut === 'credit' ? 'À crédit' : 'Payée'),
        h('td', { class: 'imp-droite' }, totalVente(v)))))),
    resume.annulees ? h('p', { class: 'imp-petit' }, `${resume.annulees} facture(s) annulée(s), barrée(s), non comptée(s) dans le total.`) : null,
    h('p', { class: 'imp-petit' }, `Imprimé le ${dateNumerique(new Date().toISOString())} · ${libelleJour(aujourdhui())}`));
  lancer(doc, `Factures ${titre} - ${p.nom_boutique}`);
}

export const boutonImprimer = (onclick, libelle = 'Imprimer / PDF') =>
  h('button', { class: 'btn btn-neutre btn-bloc', type: 'button', onclick }, icone('imprimante', 20), libelle);

