// Écran CAISSE : argent en caisse (par devise et par mode), chiffres de la période avec
// tendance, graphiques, meilleures ventes, ruptures et journal de tous les mouvements.

import * as api from './api.js';
import { h, icone, enTete, fm, fmMulti, montantsEmpiles, segment, etatVide, vider } from './ui.js';
import { convertir, formater, formaterCompact } from './money.js';
import { modePaiement } from './reference.js';
import { cleJour, heure, heureNumero, libelleJour, libelleCourt, libelleMois, libelleMoisCourt } from './temps.js';
import { courbe, barresDoubles, barresHorizontales } from './charts.js';
import { ouvrirRecu } from './vendre.js';
import { ouvrirPaiement } from './dettes.js';
import { ouvrirDepense, ouvrirFormulaireDepense } from './depenses.js';
import { badgeStock } from './articles.js';

const etatEcran = { periode: 'jour', filtre: 'tout', limite: 40 };
const PERIODES = [{ id: 'jour', libelle: "Aujourd'hui" }, { id: '7j', libelle: '7 jours' }, { id: '30j', libelle: '30 jours' }, { id: '12m', libelle: '12 mois' }];

function tendance(actuel, precedent, inverse = false) {
  if (!precedent) return h('span', { class: 'tendance tendance-neutre' }, '—');
  const pct = Math.round(((actuel - precedent) / Math.abs(precedent)) * 100);
  const bon = inverse ? pct <= 0 : pct >= 0;
  return h('span', { class: `tendance ${pct === 0 ? 'tendance-neutre' : bon ? 'positif' : 'negatif'}`, 'aria-label': `${pct >= 0 ? 'hausse' : 'baisse'} de ${Math.abs(pct)} % par rapport à la période précédente` },
    icone(pct >= 0 ? 'hausse' : 'baisse', 14), `${Math.abs(pct)} %`);
}

function carteStat(libelle, valeur, devise, actuel, precedent, { inverse = false, classe = '' } = {}) {
  return h('div', { class: 'carte-stat' },
    h('span', { class: 'legende' }, libelle),
    h('span', { class: `chiffre-m ${classe}` }, fm(valeur, devise)),
    tendance(actuel, precedent, inverse));
}

export async function afficher(racine) {
  const p = await api.profil();
  const dev = p.devise_principale;
  const b = api.bornesPeriode(etatEcran.periode);
  const [solde, stats, prec, aRecevoir, serie, categories, top, rupture, journal] = await Promise.all([
    api.soldeCaisse(), api.statsPeriode(b.debut, b.fin), api.statsPeriode(b.precDebut, b.precFin),
    api.totalARecevoir(), api.serieGraphique(etatEcran.periode), api.ventesParCategorie(b.debut, b.fin),
    api.meilleuresVentes(b.debut, b.fin), api.bientotEnRupture(), api.journalCaisse(b.debut, b.fin, etatEcran.filtre),
  ]);

  racine.append(enTete({ titre: 'Caisse' }));

  // En caisse
  const totalConverti = convertir(solde.USD, 'USD', dev, p.taux) + convertir(solde.CDF, 'CDF', dev, p.taux);
  const modes = Object.entries(solde.modes).filter(([, v]) => v.USD || v.CDF);
  racine.append(h('section', { class: 'grand-total' },
    h('p', { class: 'legende' }, 'En caisse'),
    montantsEmpiles(solde, dev, ['chiffre-xl', 'chiffre-l']),
    solde.USD && solde.CDF ? h('p', { class: 'texte-2', style: 'margin-top:4px' }, `Soit environ ${fm(totalConverti, dev)} au taux de ${formater(p.taux, 'CDF')}`) : null,
    modes.length > 1 ? h('div', { class: 'repartition' }, ...modes.map(([m, v]) =>
      h('span', { class: 'badge badge-neutre' }, `${modePaiement(m)?.nom} · ${fmMulti(v, dev)}`))) : null));

  racine.append(segment(PERIODES, etatEcran.periode, (x) => { etatEcran.periode = x; etatEcran.limite = 40; rafraichir(); }, { libelle: 'Période' }));

  racine.append(h('div', { class: 'cartes-stats', style: 'margin-top:16px' },
    carteStat('Ventes', stats.ventes, dev, stats.ventes, prec.ventes),
    carteStat('Encaissé', stats.encaisse, dev, stats.encaisse, prec.encaisse),
    carteStat('Dépenses', stats.depenses, dev, stats.depenses, prec.depenses, { inverse: true }),
    carteStat('Bénéfice', stats.benefice, dev, stats.benefice, prec.benefice, { classe: stats.benefice < 0 ? 'negatif' : '' })),
  h('a', { class: 'carte-stat', href: '#/dettes', style: 'margin-top:12px;flex-direction:row;align-items:center;justify-content:space-between' },
    h('span', { class: 'pile-serree', style: 'gap:4px' },
      h('span', { class: 'legende' }, 'À recevoir (dettes des clients)'),
      h('span', { class: 'chiffre-m negatif' }, fmMulti(aRecevoir, dev))),
    icone('droite', 22, 'chevron')),
  h('div', { class: 'actions-rapides' },
    h('button', { class: 'btn btn-secondaire', onclick: () => ouvrirFormulaireDepense(p) }, icone('plus', 20), 'Dépense'),
    h('a', { class: 'btn btn-principal', href: '#/rapports' }, icone('calendrier', 20), 'Rapports par jour')));

  // Graphiques
  const libelleCase = (c) => etatEcran.periode === 'jour' ? `${c.cle} h` : etatEcran.periode === '12m' ? libelleMoisCourt(c.cle) : libelleCourt(c.cle);
  const titreCase = (c) => etatEcran.periode === 'jour' ? `${c.cle} h – ${Number(c.cle) + 1} h` : etatEcran.periode === '12m' ? libelleMois(c.cle) : libelleJour(c.cle);
  const formats = {
    formatAxe: (v) => formaterCompact(v, dev),
    formatValeur: (v) => formater(v, dev),
    formatEtiquette: libelleCase,
    formatTitre: titreCase,
  };
  const hoteVentes = h('div');
  const hoteFlux = h('div');
  racine.append(
    h('section', { class: 'carte', style: 'margin-top:24px' },
      h('div', { class: 'carte-titre' }, h('h2', { class: 'sous-titre' }, 'Évolution des ventes'), h('span', { class: 'legende' }, dev === 'USD' ? 'en dollars' : 'en francs')),
      hoteVentes),
    h('section', { class: 'carte' },
      h('div', { class: 'carte-titre' }, h('h2', { class: 'sous-titre' }, 'Entrées et sorties')),
      hoteFlux));
  // « Aujourd'hui » : cumul des ventes heure par heure (jusqu'à l'heure actuelle).
  let pointsVentes = serie.map((c) => ({ ...c, valeur: c.ventes }));
  if (etatEcran.periode === 'jour') {
    let cumul = 0;
    const heureActuelle = heureNumero(new Date().toISOString());
    pointsVentes = pointsVentes.slice(0, Math.max(2, heureActuelle + 1)).map((c) => ({ ...c, valeur: (cumul += c.valeur) }));
  }
  courbe(hoteVentes, pointsVentes, etatEcran.periode === 'jour'
    ? { ...formats, formatTitre: (c) => `Jusqu’à ${Number(c.cle) + 1} h` } : formats);
  barresDoubles(hoteFlux, serie.map((c) => ({ ...c, a: c.entrees, b: c.sorties })), { ...formats, libelles: ['Entrées', 'Sorties'] });

  racine.append(h('section', { class: 'carte' },
    h('div', { class: 'carte-titre' }, h('h2', { class: 'sous-titre' }, 'Ventes par catégorie')),
    categories.length ? barresHorizontales(categories, (v) => formater(v, dev)) : h('p', { class: 'texte-2' }, 'Aucune vente sur cette période.')));

  racine.append(h('section', { class: 'carte' },
    h('div', { class: 'carte-titre' }, h('h2', { class: 'sous-titre' }, 'Meilleures ventes')),
    top.length ? h('div', { class: 'pile-serree' }, ...top.map((t, i) => h('div', { class: 'rangee-espace', style: 'min-height:36px' },
      h('span', { class: 'rangee', style: 'min-width:0' }, h('span', { class: 'legende num', style: 'width:18px' }, String(i + 1)), h('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, t.nom)),
      h('span', { class: 'num texte-2', style: 'white-space:nowrap' }, `${t.quantite} vendu${t.quantite > 1 ? 's' : ''}`))))
      : h('p', { class: 'texte-2' }, 'Aucune vente sur cette période.')));

  racine.append(h('section', { class: 'carte' },
    h('div', { class: 'carte-titre' }, h('h2', { class: 'sous-titre' }, 'Bientôt en rupture'), h('a', { class: 'legende', href: '#/articles' }, 'Articles ›')),
    rupture.length ? h('div', { class: 'pile-serree' }, ...rupture.map((a) => h('div', { class: 'rangee-espace', style: 'min-height:36px' },
      h('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, a.nom), badgeStock(a, p.seuil_stock_bas))))
      : h('p', { class: 'texte-2' }, 'Tout le stock est suffisant.')));

  // Journal de caisse
  const zoneJournal = h('div');
  racine.append(
    h('div', { class: 'section-titre' }, h('h2', { class: 'sous-titre' }, 'Journal de caisse')),
    segment([{ id: 'tout', libelle: 'Tout' }, { id: 'entrees', libelle: 'Entrées' }, { id: 'sorties', libelle: 'Sorties' }, { id: 'clients', libelle: 'Clients' }],
      etatEcran.filtre, (x) => { etatEcran.filtre = x; etatEcran.limite = 40; rafraichir(); }, { libelle: 'Filtre du journal' }),
    zoneJournal);
  dessinerJournal(zoneJournal, journal, dev);

  async function rafraichir() {
    const conteneur = racine;
    const y = window.scrollY;
    const neuf = h('div', { class: 'ecran' });
    await afficher(neuf);
    conteneur.replaceChildren(...neuf.childNodes);
    window.scrollTo(0, y);
  }
}

function dessinerJournal(zone, journal, dev) {
  vider(zone);
  zone.style.marginTop = '12px';
  if (!journal.length) {
    zone.append(etatVide({ icone: 'caisse', titre: 'Aucun mouvement', texte: 'Les ventes payées, acomptes, paiements de clients et dépenses de la période apparaîtront ici.' }));
    return;
  }
  const visibles = journal.slice(0, etatEcran.limite);
  const jours = new Map();
  for (const m of visibles) {
    const c = cleJour(m.cree_le);
    if (!jours.has(c)) jours.set(c, []);
    jours.get(c).push(m);
  }
  for (const [cle, liste] of jours) {
    zone.append(
      h('a', { class: 'groupe-titre', href: `#/rapports/${cle}`, 'aria-label': `Rapport du ${libelleJour(cle)}` },
        h('span', { class: 'surtitre' }, libelleJour(cle)), h('span', { class: 'legende' }, 'Rapport ›')),
      h('div', { class: 'liste' }, ...liste.map((m) => ligneMouvement(m))));
  }
  if (journal.length > visibles.length) {
    zone.append(h('button', { class: 'btn btn-neutre btn-bloc', style: 'margin-top:16px', onclick: () => { etatEcran.limite += 60; dessinerJournal(zone, journal, dev); } },
      `Voir plus (${journal.length - visibles.length} restants)`));
  }
}

export function ligneMouvement(m) {
  const entree = m.type === 'entree';
  const ouvrir = () => {
    if (m.source === 'vente' || m.source === 'acompte') ouvrirRecu(m.reference_id);
    else if (m.source === 'paiement_dette') ouvrirPaiement(m.reference_id);
    else if (m.source === 'depense') ouvrirDepense(m.reference_id);
  };
  return h('button', { class: 'liste-ligne', onclick: ouvrir },
    h('span', { class: `icone-ronde ${m.annule_le ? '' : entree ? 'positif' : 'negatif'}` }, icone(m.source === 'paiement_dette' ? 'piece' : entree ? 'entree' : 'sortie', 20)),
    h('span', { class: 'liste-ligne-corps' },
      h('span', { class: `liste-ligne-titre${m.annule_le ? ' barre-annule' : ''}` }, m.libelle),
      h('span', { class: 'liste-ligne-sous' }, `${heure(m.cree_le)} · ${modePaiement(m.mode)?.nom}${m.annule_le ? ` · annulé à ${heure(m.annule_le)}` : ''}`)),
    h('span', { class: 'liste-ligne-fin' },
      h('span', { class: `liste-ligne-montant ${m.annule_le ? 'barre-annule' : entree ? 'positif' : 'negatif'}` }, fm(entree ? m.montant : -m.montant, m.devise, { signe: true }))));
}
