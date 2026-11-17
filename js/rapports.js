// RAPPORTS JOURNALIERS : liste de tous les jours (groupés par mois, défilement continu),
// calendrier, et rapport complet d'un jour avec partage WhatsApp.

import * as api from './api.js';
import { h, icone, enTete, fm, fmMulti, ouvrirFeuille, partager, etatVide } from './ui.js';
import { formater } from './money.js';
import { modePaiement } from './reference.js';
import { aujourdhui, ajouterJours, ajouterMois, heure, libelleJour, libelleMois } from './temps.js';
import { ouvrirRecu } from './vendre.js';
import { ligneDepense } from './depenses.js';

/* ---------- Liste des jours ---------- */

export async function afficherListe(racine) {
  const [p, activite, premiere] = await Promise.all([api.profil(), api.activiteParJour(), api.premiereActivite()]);
  const dev = p.devise_principale;
  const fin = aujourdhui();
  racine.append(enTete({
    titre: 'Rapports', retour: '#/caisse',
    actions: premiere ? [h('button', { class: 'btn-icone', 'aria-label': 'Choisir une date', onclick: () => feuilleCalendrier(activite, premiere) }, icone('calendrier', 24))] : [],
  }));
  if (!premiere) {
    racine.append(etatVide({ icone: 'calendrier', titre: 'Aucun rapport pour l’instant', texte: 'Chaque jour avec des ventes, des paiements ou des dépenses aura son rapport ici.' }));
    return;
  }

  const zone = h('div');
  const sentinelle = h('div', { style: 'height:1px' });
  racine.append(zone, sentinelle);
  let mois = fin.slice(0, 7);
  const dernierMois = premiere.slice(0, 7);

  function ajouterMoisSuivant() {
    if (mois < dernierMois) return false;
    const jours = [];
    for (let j = mois === fin.slice(0, 7) ? fin : finDuMois(mois); j.startsWith(mois) && j >= premiere; j = ajouterJours(j, -1)) jours.push(j);
    const tot = { ventes: 0, encaisse: 0, depenses: 0, benefice: 0 };
    for (const j of jours) {
      const a = activite.get(j);
      if (a) { tot.ventes += a.ventes; tot.encaisse += a.encaisse; tot.depenses += a.depenses; tot.benefice += a.benefice; }
    }
    zone.append(
      h('div', { class: 'groupe-titre', style: 'margin-top:24px' }, h('h2', { class: 'sous-titre' }, libelleMois(mois))),
      h('div', { class: 'cartes-stats', style: 'grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:12px' },
        resumeMini('Ventes', tot.ventes, dev),
        resumeMini('Encaissé', tot.encaisse, dev),
        resumeMini('Dépenses', tot.depenses, dev, 'negatif'),
        resumeMini('Bénéfice', tot.benefice, dev, tot.benefice < 0 ? 'negatif' : 'positif')),
      h('div', { class: 'liste' }, ...jours.map((j) => ligneJour(j, activite.get(j), dev))));
    mois = ajouterMois(mois, -1);
    return true;
  }

  ajouterMoisSuivant();
  ajouterMoisSuivant();
  if ('IntersectionObserver' in window) {
    const obs = new IntersectionObserver((entrees) => {
      if (entrees.some((e) => e.isIntersecting) && !ajouterMoisSuivant()) obs.disconnect();
    }, { rootMargin: '600px' });
    obs.observe(sentinelle);
  } else {
    while (ajouterMoisSuivant());
  }
}

function finDuMois(mois) { return ajouterJours(ajouterMois(mois, 1) + '-01', -1); }

function resumeMini(libelle, valeur, dev, classe = '') {
  return h('div', { class: 'carte-stat', style: 'padding:12px' },
    h('span', { class: 'legende' }, libelle),
    h('span', { class: `num ${classe}`, style: 'font-weight:700;font-size:17px' }, fm(valeur, dev)));
}

function ligneJour(cle, a, dev) {
  const actif = a && a.operations > 0;
  const solde = actif ? a.encaisse - a.depenses : 0;
  return h('a', { class: `liste-ligne ligne-jour${actif ? '' : ' inactif'}`, href: `#/rapports/${cle}` },
    actif ? h('span', { class: `indicateur ${solde >= 0 ? 'positif' : 'negatif'}`, 'aria-label': solde >= 0 ? 'Journée positive' : 'Journée négative' }) : h('span', { class: 'indicateur' }),
    h('span', { class: 'liste-ligne-corps' },
      h('span', { class: 'liste-ligne-titre' }, libelleJour(cle, { annee: false })),
      h('span', { class: 'liste-ligne-sous num' }, actif ? `Encaissé ${formater(a.encaisse, dev)} · Dépenses ${formater(a.depenses, dev)}` : 'Aucune activité')),
    actif ? h('span', { class: 'liste-ligne-fin' }, h('span', { class: 'liste-ligne-montant' }, fm(a.ventes, dev)), h('span', { class: 'legende' }, 'ventes')) : null);
}

/* ---------- Calendrier ---------- */

function feuilleCalendrier(activite, premiere) {
  const fin = aujourdhui();
  let mois = fin.slice(0, 7);
  const f = ouvrirFeuille({ titre: 'Aller à une date', contenu: () => grille() });
  function grille() {
    const premierJour = mois + '-01';
    const decalage = (new Date(premierJour + 'T12:00:00Z').getUTCDay() + 6) % 7; // lundi = 0
    const cases = [];
    for (let i = 0; i < decalage; i++) cases.push(h('span'));
    for (let j = premierJour; j.startsWith(mois); j = ajouterJours(j, 1)) {
      const a = activite.get(j);
      const actif = a && a.operations > 0;
      const cle = j;
      cases.push(h('button', {
        class: `jour-cal${actif ? ' actif' : ' inactif'}${j === fin ? ' aujourdhui' : ''}`,
        disabled: j > fin, 'aria-label': libelleJour(j) + (actif ? '' : ', aucune activité'),
        onclick: () => { f.fermer(); location.hash = `#/rapports/${cle}`; },
      }, String(Number(j.slice(8)))));
    }
    const precedent = h('button', { class: 'btn-icone', 'aria-label': 'Mois précédent', disabled: mois <= premiere.slice(0, 7), onclick: () => { mois = ajouterMois(mois, -1); f.remplacer(grille()); } }, icone('gauche', 22));
    const suivant = h('button', { class: 'btn-icone', 'aria-label': 'Mois suivant', disabled: mois >= fin.slice(0, 7), onclick: () => { mois = ajouterMois(mois, 1); f.remplacer(grille()); } }, icone('droite', 22));
    return h('div', {},
      h('div', { class: 'calendrier-tete' }, precedent, h('strong', { class: 'sous-titre' }, libelleMois(mois)), suivant),
      h('div', { class: 'calendrier-grille' },
        ...['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => h('span', { class: 'jsem', 'aria-hidden': 'true' }, x)),
        ...cases),
      h('p', { class: 'champ-aide', style: 'margin-top:12px;text-align:center' }, 'Les jours en couleur ont de l’activité.'));
  }
}

/* ---------- Rapport d'un jour ---------- */

export async function afficherJour(racine, cle) {
  const [p, r] = await Promise.all([api.profil(), api.rapportDuJour(cle)]);
  const dev = p.devise_principale;
  const fin = aujourdhui();

  racine.append(enTete({ titre: 'Rapport du jour', retour: '#/rapports' }));
  racine.append(h('div', { class: 'navigation-jour' },
    h('a', { class: 'btn-rond', href: `#/rapports/${ajouterJours(cle, -1)}`, 'aria-label': 'Jour précédent' }, icone('gauche', 22)),
    h('h2', { class: 'sous-titre' }, libelleJour(cle)),
    cle < fin ? h('a', { class: 'btn-rond', href: `#/rapports/${ajouterJours(cle, 1)}`, 'aria-label': 'Jour suivant' }, icone('droite', 22))
      : h('button', { class: 'btn-rond', disabled: true, 'aria-label': 'Jour suivant' }, icone('droite', 22))));

  const vide = !r.ventes.length && !r.paiements.length && !r.depenses.length;
  racine.append(h('div', { class: 'cartes-stats' },
    stat('Ventes du jour', fm(r.stats.ventes, dev)),
    stat('Bénéfice', fm(r.stats.benefice, dev), r.stats.benefice < 0 ? 'negatif' : 'positif'),
    stat('Encaissé', fm(r.stats.encaisse, dev)),
    stat('Dépenses', fm(r.stats.depenses, dev), 'negatif'),
    stat('Prix d’achat vendu', fm(r.stats.cout, dev)),
    stat('Nouvelles dettes', fm(r.nouvellesDettesTotal, dev))),
  h('div', { class: 'carte', style: 'margin-top:12px' },
    h('div', { class: 'rangee-espace' },
      h('div', { class: 'pile-serree', style: 'gap:2px;min-width:0' }, h('span', { class: 'legende' }, 'Caisse au début'), h('span', { class: 'num', style: 'font-weight:600' }, fmMulti(r.soldeDebut, dev))),
      icone('droite', 20, 'chevron'),
      h('div', { class: 'pile-serree', style: 'gap:2px;text-align:right;min-width:0' }, h('span', { class: 'legende' }, 'Caisse à la fin'), h('span', { class: 'num', style: 'font-weight:700' }, fmMulti(r.soldeFin, dev)))),
    r.taux.length ? h('p', { class: 'champ-aide', style: 'margin-top:8px' }, `Taux utilisé${r.taux.length > 1 ? 's' : ''} : ${r.taux.map((t) => `1 $ = ${formater(t, 'CDF')}`).join(', ')}`) : null));

  if (vide) {
    racine.append(etatVide({ icone: 'calendrier', titre: 'Aucune activité ce jour-là', texte: 'Pas de vente, de paiement ni de dépense.' }));
    return;
  }

  racine.append(h('button', { class: 'btn btn-secondaire btn-bloc', style: 'margin-top:16px', onclick: () => partager(texteRapport(p, r)) }, icone('partager', 20), 'Partager le rapport'));

  if (r.ventes.length) {
    racine.append(titreSection('Ventes réalisées', r.ventes.filter((x) => !x.vente.annule_le).length),
      h('div', { class: 'liste' }, ...r.ventes.map((x) => ligneVente(x))));
  }
  if (r.paiements.length) {
    racine.append(titreSection('Paiements reçus des clients', r.paiements.filter((x) => !x.paiement.annule_le).length),
      h('div', { class: 'liste' }, ...r.paiements.map(({ paiement: pm, client, reste_apres }) => h('a', { class: 'liste-ligne', href: `#/dettes/${client?.id}` },
        h('span', { class: 'icone-ronde positif' }, icone('piece', 20)),
        h('span', { class: 'liste-ligne-corps' },
          h('span', { class: `liste-ligne-titre${pm.annule_le ? ' barre-annule' : ''}` }, client?.nom || 'Client'),
          h('span', { class: 'liste-ligne-sous' }, pm.annule_le ? `Annulé à ${heure(pm.annule_le)}` : `${heure(pm.cree_le)} · reste ${formater(reste_apres, pm.devise)}`)),
        h('span', { class: 'liste-ligne-fin' }, h('span', { class: `liste-ligne-montant ${pm.annule_le ? 'barre-annule' : 'positif'}` }, fm(pm.montant_recu, pm.devise_recue, { signe: true })))))));
  }
  if (r.nouvellesDettes.length) {
    racine.append(titreSection('Nouvelles dettes', r.nouvellesDettes.length),
      h('div', { class: 'liste' }, ...r.nouvellesDettes.map(({ dette: d, client }) => h('a', { class: 'liste-ligne', href: `#/dettes/${client?.id}` },
        h('span', { class: 'icone-ronde negatif' }, icone('dettes', 20)),
        h('span', { class: 'liste-ligne-corps' },
          h('span', { class: 'liste-ligne-titre' }, client?.nom || 'Client'),
          h('span', { class: 'liste-ligne-sous' }, `Achat ${formater(d.montant_vente, d.devise)}${d.acompte ? ` · acompte ${formater(d.acompte, d.devise)}` : ''}`)),
        h('span', { class: 'liste-ligne-fin' }, h('span', { class: 'liste-ligne-montant negatif' }, fm(d.montant, d.devise)), h('span', { class: 'legende' }, 'reste'))))));
  }
  if (r.depenses.length) {
    racine.append(titreSection('Dépenses du jour', r.depenses.filter((d) => !d.annule_le).length),
      h('div', { class: 'liste' }, ...r.depenses.map((d) => ligneDepense(p, d))));
  }
  if (r.articlesVendus.length) {
    racine.append(titreSection('Articles vendus', r.articlesVendus.reduce((s, a) => s + a.quantite, 0)),
      h('div', { class: 'carte pile-serree' }, ...r.articlesVendus.map((a) => h('div', { class: 'rangee-espace', style: 'min-height:32px' },
        h('span', { style: 'min-width:0;overflow-wrap:anywhere' }, a.nom), h('strong', { class: 'num' }, `× ${a.quantite}`)))));
  }
}

const stat = (libelle, valeur, classe = '') => h('div', { class: 'carte-stat' },
  h('span', { class: 'legende' }, libelle), h('span', { class: `chiffre-m ${classe}` }, valeur));

const titreSection = (titre, n) => h('div', { class: 'section-titre' },
  h('h2', { class: 'surtitre' }, titre), h('span', { class: 'legende num' }, String(n)));

function ligneVente({ vente: v, lignes, client, dette }) {
  const resume = lignes.map((l) => (l.quantite > 1 ? `${l.quantite} × ` : '') + l.nom).join(', ');
  const statut = v.annule_le ? h('span', { class: 'badge badge-zero' }, `Annulée ${heure(v.annule_le)}`)
    : v.statut === 'payee' ? h('span', { class: 'badge badge-ok' }, `Payée · ${modePaiement(v.mode)?.nom}`)
      : dette?.acompte ? h('span', { class: 'badge badge-bas' }, 'Acompte reçu') : h('span', { class: 'badge badge-accent' }, 'À crédit');
  return h('button', { class: 'liste-ligne', onclick: () => ouvrirRecu(v.id) },
    h('span', { class: 'liste-ligne-corps' },
      h('span', { class: `liste-ligne-titre${v.annule_le ? ' barre-annule' : ''}` }, resume),
      h('span', { class: 'liste-ligne-sous' }, `${heure(v.cree_le)}${client ? ' · ' + client.nom : ''}`)),
    h('span', { class: 'liste-ligne-fin' },
      h('span', { class: `liste-ligne-montant${v.annule_le ? ' barre-annule' : ''}` }, fm(v.total, v.devise)),
      statut));
}

function texteRapport(p, r) {
  const dev = p.devise_principale;
  const L = [
    `*${p.nom_boutique}*`,
    `Rapport du ${libelleJour(r.cle, { annee: true }).toLowerCase()}`,
    '',
    `Ventes : ${formater(r.stats.ventes, dev)} (${r.stats.nbVentes} vente${r.stats.nbVentes > 1 ? 's' : ''})`,
    `Encaissé : ${formater(r.stats.encaisse, dev)}`,
    `Dépenses : ${formater(r.stats.depenses, dev)}`,
    `Bénéfice : ${formater(r.stats.benefice, dev)}`,
    `Caisse en fin de journée : ${fmMulti(r.soldeFin, dev)}`,
  ];
  const payes = r.paiements.filter((x) => !x.paiement.annule_le);
  if (payes.length) {
    L.push('', 'Clients qui ont payé :');
    for (const x of payes) L.push(`- ${x.client?.nom} : ${formater(x.paiement.montant_recu, x.paiement.devise_recue)} (reste ${formater(x.reste_apres, x.paiement.devise)})`);
  }
  return L.join('\n');
}
