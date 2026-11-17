// Onglet FACTURES : chaque vente est une facture numérotée (n° 1, 2, 3…).
// Liste par jour, par semaine (lundi → dimanche) ou par mois, avec flèches pour remonter le temps.

import * as api from './api.js';
import { h, icone, enTete, fmMulti, fmVente, segment, etatVide } from './ui.js';
import { modePaiement } from './reference.js';
import { cleJour, heure, libelleJour, libelleCourt, libelleMois, dateNumerique, aujourdhui, joursEntre } from './temps.js';
import { ouvrirRecu } from './vendre.js';
import { imprimerListe, boutonImprimer } from './impression.js';

const etatEcran = { periode: 'jour', decalage: 0 };
const PERIODES = [{ id: 'jour', libelle: 'Jour' }, { id: 'semaine', libelle: 'Semaine' }, { id: 'mois', libelle: 'Mois' }];

function libellePeriode(periode, decalage, debut, fin) {
  if (periode === 'jour') return libelleJour(debut, { annee: true });
  if (periode === 'semaine') return decalage === 0 ? 'Cette semaine' : `Du ${libelleCourt(debut)} au ${libelleCourt(fin)}`;
  return decalage === 0 ? `${libelleMois(debut.slice(0, 7))} (ce mois)` : libelleMois(debut.slice(0, 7));
}

// Conteneur réellement affiché : les changements de période redessinent dedans.
let hote = null;

export async function afficher(racine, { redessin = false } = {}) {
  if (!redessin) hote = racine;
  const p = await api.profil();
  const { periode, decalage } = etatEcran;
  const b = api.bornesFactures(periode, decalage);
  const { liste, resume } = await api.factures(b.debut, b.fin);
  const changer = (n) => { etatEcran.decalage = n; rafraichir(); };

  racine.append(
    enTete({ titre: 'Factures' }),
    segment(PERIODES, periode, (x) => { etatEcran.periode = x; etatEcran.decalage = 0; rafraichir(); }, { libelle: 'Période des factures' }),
    h('div', { class: 'navigation-jour', style: 'margin-top:16px' },
      h('button', { class: 'btn-rond', 'aria-label': 'Période précédente', onclick: () => changer(decalage - 1) }, icone('gauche', 22)),
      h('div', { style: 'flex:1;text-align:center' },
        h('h2', { class: 'sous-titre' }, libellePeriode(periode, decalage, b.debut, b.fin)),
        h('p', { class: 'legende' }, periode === 'jour'
          ? (decalage === 0 ? "Aujourd'hui" : decalage === -1 ? 'Hier' : dateNumerique(b.debut + 'T12:00:00Z'))
          : `${libelleCourt(b.debut)} – ${libelleCourt(b.fin)}`)),
      h('button', { class: 'btn-rond', 'aria-label': 'Période suivante', disabled: decalage >= 0, onclick: () => changer(decalage + 1) }, icone('droite', 22))),
    choixDate(periode === 'jour' ? b.debut : ''),
    h('section', { class: 'carte' },
      h('div', { class: 'rangee-espace' },
        h('div', {},
          h('p', { class: 'legende' }, `${resume.nombre} facture${resume.nombre > 1 ? 's' : ''}`),
          h('p', { class: 'chiffre-m' }, fmMulti(resume.totaux, p.devise_principale))),
        h('div', { style: 'text-align:right' },
          h('p', { class: 'legende' }, `Payées : ${resume.payees}`),
          h('p', { class: 'legende' }, `À crédit : ${resume.credit}`),
          resume.annulees ? h('p', { class: 'legende' }, `Annulées : ${resume.annulees}`) : null)),
      liste.length ? h('div', { style: 'margin-top:12px' }, boutonImprimer(() => imprimerListe({
        p, titre: libellePeriode(periode, decalage, b.debut, b.fin).toLowerCase(), debut: b.debut, fin: b.fin, liste, resume,
      }), 'Imprimer la liste / PDF')) : null),
  );

  if (!liste.length) {
    racine.append(etatVide({ icone: 'facture', titre: 'Aucune facture', texte: 'Les ventes de cette période apparaîtront ici, chacune avec son numéro de facture.' }));
    return;
  }

  // Regroupées par date (un titre par jour, même pour un seul jour)
  const jours = new Map();
  for (const x of liste) {
    const c = cleJour(x.vente.cree_le);
    if (!jours.has(c)) jours.set(c, []);
    jours.get(c).push(x);
  }
  const zone = h('div', { style: 'margin-top:24px' });
  for (const [cle, factures] of jours) {
    zone.append(h('a', { class: 'groupe-titre', href: `#/rapports/${cle}` },
      h('span', { class: 'surtitre' }, libelleJour(cle, { annee: true })),
      h('span', { class: 'legende' }, `${factures.length} facture${factures.length > 1 ? 's' : ''} ›`)));
    zone.append(h('div', { class: 'liste' }, ...factures.map(ligneFacture)));
  }
  racine.append(zone);

}

async function rafraichir() {
  const y = window.scrollY;
  const neuf = h('div');
  await afficher(neuf, { redessin: true });
  hote.replaceChildren(...neuf.childNodes);
  window.scrollTo(0, y);
}

// Aller directement aux factures d'une date précise (calendrier du téléphone).
function choixDate(valeur) {
  const jour = aujourdhui();
  const champ = h('input', { type: 'date', class: 'saisie', max: jour, value: valeur, 'aria-label': 'Choisir une date' });
  champ.addEventListener('change', () => {
    if (!champ.value) return;
    etatEcran.periode = 'jour';
    etatEcran.decalage = Math.min(0, joursEntre(jour, champ.value));
    rafraichir();
  });
  return h('label', { class: 'taux-vente', style: 'margin-bottom:16px' },
    h('span', { class: 'champ-libelle' }, icone('calendrier', 18), ' Aller à une date'),
    champ);
}

function ligneFacture({ vente: v, lignes, client }) {
  const articles = lignes.map((l) => (l.quantite > 1 ? `${l.quantite} × ` : '') + l.nom).join(', ');
  const statut = v.annule_le ? h('span', { class: 'badge badge-zero' }, 'Annulée')
    : v.statut === 'credit' ? h('span', { class: 'badge badge-accent' }, 'À crédit')
      : h('span', { class: 'badge badge-ok' }, 'Payée');
  return h('button', { class: 'liste-ligne', onclick: () => ouvrirRecu(v.id), 'aria-label': `Facture numéro ${v.numero}` },
    h('span', { class: 'icone-ronde accent' }, icone('facture', 20)),
    h('span', { class: 'liste-ligne-corps' },
      h('span', { class: `liste-ligne-titre${v.annule_le ? ' barre-annule' : ''}` }, `Facture n° ${v.numero}`),
      h('span', { class: 'liste-ligne-sous' }, `${dateNumerique(v.cree_le)} à ${heure(v.cree_le)}`),
      h('span', { class: 'liste-ligne-sous' }, client ? `Client : ${client.nom}` : (v.statut === 'payee' && !v.annule_le ? modePaiement(v.mode)?.nom ?? '' : '')),
      h('span', { class: 'liste-ligne-sous' }, articles)),
    h('span', { class: 'liste-ligne-fin' },
      h('span', { class: `liste-ligne-montant${v.annule_le ? ' barre-annule' : ''}` }, fmVente(v)),
      statut));
}
