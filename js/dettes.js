// Écran DETTES : total à recevoir, liste des clients, fiche complète d'un client,
// encaissement d'un paiement (même dans l'autre devise), annulation et reçus à partager.

import * as api from './api.js';
import {
  h, icone, enTete, fm, fmMulti, montantsEmpiles, segment, saisie, champ, champMontant, puces,
  ouvrirFeuille, confirmer, toast, erreur, vibrer, partager, enCours, etatVide, optionsModes, vider,
} from './ui.js';
import { convertir, formater } from './money.js';
import { modePaiement } from './reference.js';
import { anciennete, cleJour, heure, libelleJour, dateNumerique } from './temps.js';

const etatEcran = { filtre: 'encours', recherche: '' };

const DEVISES_ORDRE = (p) => [p.devise_principale, p.devise_principale === 'USD' ? 'CDF' : 'USD'];

export async function afficher(racine) {
  const [p, clients, aRecevoir, recupere] = await Promise.all([
    api.profil(), api.dettesParClient(), api.totalARecevoir(), api.recupereCeMois(),
  ]);
  racine.append(enTete({ titre: 'Dettes' }));

  racine.append(h('section', { class: 'grand-total' },
    h('p', { class: 'legende' }, 'Total à recevoir'),
    montantsEmpiles(aRecevoir, p.devise_principale),
    h('p', { class: 'texte-2', style: 'margin-top:6px' }, 'Déjà récupéré ce mois : ', h('strong', { class: 'num positif' }, fm(recupere, p.devise_principale)))));

  if (!clients.length) {
    racine.append(etatVide({
      icone: 'dettes', titre: 'Aucune dette',
      texte: 'Quand tu vends « À crédit », le client et ce qu’il doit apparaissent ici.',
    }));
    return;
  }

  const liste = h('div', { class: 'liste' });
  const recherche = saisie({
    type: 'search', placeholder: 'Rechercher un client', value: etatEcran.recherche, 'aria-label': 'Rechercher un client',
    oninput: () => { etatEcran.recherche = recherche.value; dessiner(); },
  });
  const nbEnCours = clients.filter((c) => !c.soldee).length;
  racine.append(h('div', { class: 'barre-outils' },
    segment([{ id: 'encours', libelle: `En cours (${nbEnCours})` }, { id: 'soldees', libelle: `Soldées (${clients.length - nbEnCours})` }],
      etatEcran.filtre, (f) => { etatEcran.filtre = f; dessiner(); }, { libelle: 'Filtre des dettes' }),
    h('div', { class: 'recherche' }, icone('recherche', 20), recherche)), liste);

  function dessiner() {
    const q = etatEcran.recherche.trim().toLowerCase();
    const filtres = clients.filter((c) => (etatEcran.filtre === 'encours' ? !c.soldee : c.soldee)
      && (!q || c.client.nom.toLowerCase().includes(q)));
    vider(liste);
    if (!filtres.length) {
      liste.append(h('p', { class: 'liste-vide' }, etatEcran.filtre === 'encours' ? 'Aucune dette en cours.' : 'Aucune dette soldée.'));
      return;
    }
    liste.append(...filtres.map((c) => {
      const pct = c.duP > 0 ? Math.min(100, (c.payeP / c.duP) * 100) : 100;
      return h('a', { class: 'liste-ligne', href: `#/dettes/${c.client.id}` },
        h('span', { class: 'icone-ronde accent', style: 'font-weight:700' }, c.client.nom.charAt(0).toUpperCase()),
        h('span', { class: 'liste-ligne-corps' },
          h('span', { class: 'liste-ligne-titre' }, c.client.nom),
          h('span', { class: 'progression', style: 'margin:6px 0 4px' }, h('span', { style: `width:${pct.toFixed(0)}%` })),
          h('span', { class: 'liste-ligne-sous' }, c.soldee ? 'Tout est payé' : `Depuis ${anciennete(c.plusAncienne).replace('il y a ', '')}`)),
        h('span', { class: 'liste-ligne-fin' },
          c.soldee ? h('span', { class: 'badge badge-ok' }, 'Soldée')
            : h('span', { class: 'liste-ligne-montant negatif' }, fmMulti(c.reste, p.devise_principale)),
          !c.soldee ? h('span', { class: 'legende' }, 'reste à payer') : null),
        icone('droite', 20, 'chevron'));
    }));
  }
  dessiner();
}

/* ---------- Fiche d'un client ---------- */

export async function afficherFiche(racine, clientId) {
  const [p, fiche] = await Promise.all([api.profil(), api.ficheClient(clientId)]);
  const c = fiche.client;
  racine.append(enTete({
    titre: c.nom, sousTitre: c.telephone, retour: '#/dettes',
    actions: c.telephone ? [h('a', { class: 'btn-icone', href: `tel:${c.telephone.replace(/[^+0-9]/g, '')}`, 'aria-label': `Appeler ${c.nom}` }, icone('telephone', 22))] : [],
  }));

  const devises = DEVISES_ORDRE(p).filter((d) => fiche.du[d] > 0);
  for (const d of devises) {
    const pct = fiche.du[d] > 0 ? Math.min(100, (fiche.paye[d] / fiche.du[d]) * 100) : 0;
    const soldee = fiche.reste[d] <= 0;
    racine.append(h('section', { class: 'carte' },
      h('div', { class: 'carte-titre' },
        h('span', { class: 'surtitre' }, devises.length > 1 ? `Dettes en ${d === 'USD' ? 'dollars' : 'francs'}` : 'Situation'),
        soldee ? h('span', { class: 'badge badge-ok' }, icone('coche', 14), 'Soldée') : null),
      h('div', { class: 'trois-chiffres' },
        h('div', {}, h('span', { class: 'legende' }, 'Total dû'), h('span', { class: 'chiffre-m' }, fm(fiche.du[d], d))),
        h('div', {}, h('span', { class: 'legende' }, 'Déjà payé'), h('span', { class: 'chiffre-m positif' }, fm(fiche.paye[d], d))),
        h('div', {}, h('span', { class: 'legende' }, 'Reste à payer'), h('span', { class: `chiffre-m ${soldee ? '' : 'negatif'}` }, fm(fiche.reste[d], d)))),
      h('div', { class: 'progression', style: 'margin-top:16px' }, h('span', { style: `width:${pct.toFixed(0)}%` }))));
  }

  const reste = DEVISES_ORDRE(p).some((d) => fiche.reste[d] > 0);
  const dernierPaiement = fiche.historique.find((e) => e.type === 'paiement' && !e.paiement.annule_le);
  racine.append(h('div', { class: 'pile', style: 'margin-top:16px' },
    reste ? h('button', { class: 'btn btn-principal btn-bloc btn-grand', onclick: () => feuilleEncaisser(p, fiche) }, icone('piece', 22), 'Encaisser un paiement') : null,
    dernierPaiement ? h('button', { class: 'btn btn-secondaire btn-bloc', onclick: () => partager(texteRecuPaiement(p, c, dernierPaiement.paiement, dernierPaiement.reste_apres)) },
      icone('partager', 20), 'Partager le reçu') : null));

  racine.append(h('div', { class: 'section-titre' }, h('h2', { class: 'sous-titre' }, 'Historique')));
  if (!fiche.historique.length) {
    racine.append(h('div', { class: 'liste' }, h('p', { class: 'liste-vide' }, 'Aucune opération.')));
    return;
  }
  racine.append(h('div', { class: 'liste' }, ...fiche.historique.map((e) => ligneHistorique(p, c, e))));
}

function ligneHistorique(p, client, e) {
  const date = `${libelleJour(cleJour(e.quand))} · ${heure(e.quand)}`;
  const versRapport = () => { location.hash = `#/rapports/${cleJour(e.quand)}`; };
  if (e.type === 'achat') {
    const d = e.dette;
    const articles = e.lignes.map((l) => (l.quantite > 1 ? `${l.quantite} × ` : '') + l.nom).join(', ');
    return h('button', { class: 'liste-ligne', onclick: versRapport, 'aria-label': `Achat à crédit du ${date}, voir le rapport du jour` },
      h('span', { class: 'icone-ronde negatif' }, icone('vendre', 20)),
      h('span', { class: 'liste-ligne-corps' },
        h('span', { class: 'liste-ligne-titre' }, 'Achat à crédit'),
        h('span', { class: 'liste-ligne-sous' }, articles),
        h('span', { class: 'liste-ligne-sous' }, date),
        d.acompte ? h('span', { class: 'liste-ligne-sous' }, `Acompte ${formater(d.acompte, d.devise)} sur ${formater(d.montant_vente, d.devise)}`) : null),
      h('span', { class: 'liste-ligne-fin' }, h('span', { class: 'liste-ligne-montant' }, fm(d.montant, d.devise))));
  }
  const pm = e.paiement;
  return h('button', { class: 'liste-ligne', onclick: () => ouvrirPaiement(pm.id), 'aria-label': `Paiement du ${date}` },
      h('span', { class: 'icone-ronde positif' }, icone('piece', 20)),
      h('span', { class: 'liste-ligne-corps' },
        h('span', { class: `liste-ligne-titre${pm.annule_le ? ' barre-annule' : ''}` }, `Paiement · ${modePaiement(pm.mode)?.nom}`),
        h('span', { class: 'liste-ligne-sous' }, date),
        pm.annule_le ? h('span', { class: 'liste-ligne-sous negatif' }, `Annulé à ${heure(pm.annule_le)}`)
          : h('span', { class: 'liste-ligne-sous' }, `Reste après : ${formater(e.reste_apres, pm.devise)}`)),
      h('span', { class: 'liste-ligne-fin' },
        h('span', { class: `liste-ligne-montant ${pm.annule_le ? 'barre-annule' : 'positif'}` }, fm(pm.montant_recu, pm.devise_recue, { signe: true })),
        pm.devise_recue !== pm.devise ? h('span', { class: 'legende' }, `= ${formater(pm.montant, pm.devise)}`) : null),
      icone('droite', 20, 'chevron'));
}

async function annulerUnPaiement(pm) {
  const ok = await confirmer({
    titre: 'Annuler ce paiement ?',
    message: `${formater(pm.montant_recu, pm.devise_recue)} seront retirés de la caisse et ajoutés de nouveau au reste à payer.`,
    ok: 'Annuler le paiement', danger: true,
  });
  if (!ok) return false;
  try { await api.annulerPaiement(pm.id); toast('Paiement annulé. La dette et la caisse sont corrigées.'); return true; } catch (e) { erreur(e); return false; }
}

/* ---------- Encaisser un paiement ---------- */

function feuilleEncaisser(p, fiche) {
  const client = fiche.client;
  const devisesDues = DEVISES_ORDRE(p).filter((d) => fiche.reste[d] > 0);
  let deviseDette = devisesDues[0];
  let mode = 'cash';

  const aide = h('p', { class: 'champ-aide' });
  let montant = null;
  const zoneMontant = h('div');
  const note = saisie({ placeholder: 'Note (facultatif)', maxlength: 120, 'aria-label': 'Note' });

  function construireMontant() {
    montant = champMontant({
      devise: deviseDette, valeur: fiche.reste[deviseDette], libelle: 'Montant reçu',
      onSaisie: majAide,
      onDevise: (d) => { montant.definir(convertir(fiche.reste[deviseDette], deviseDette, d, p.taux)); },
    });
    zoneMontant.replaceChildren(montant.el, aide);
    majAide();
  }
  function majAide() {
    const reste = fiche.reste[deviseDette];
    const recu = montant.lire();
    if (!recu) { aide.textContent = `Reste à payer : ${formater(reste, deviseDette)}`; return; }
    const max = convertir(reste, deviseDette, montant.devise(), p.taux);
    if (recu > max) { aide.textContent = `Trop élevé : le reste à payer est ${formater(max, montant.devise())}.`; aide.className = 'champ-aide negatif'; return; }
    aide.className = 'champ-aide';
    const contre = Math.min(convertir(recu, montant.devise(), deviseDette, p.taux), reste);
    const conversion = montant.devise() !== deviseDette ? ` (= ${formater(contre, deviseDette)} au taux ${formater(p.taux, 'CDF')})` : '';
    aide.textContent = `Reste après ce paiement : ${formater(reste - contre, deviseDette)}${conversion}`;
  }

  const valider = h('button', { class: 'btn btn-principal btn-bloc btn-grand' }, 'Encaisser');
  valider.addEventListener('click', enCours(valider, async () => {
    try {
      const recu = montant.lire();
      if (!recu) { montant.signalerErreur(); throw new api.ErreurMetier('Saisis le montant reçu.'); }
      const r = await api.encaisserPaiement({
        client_id: client.id, devise_dette: deviseDette, montant_recu: recu, devise_recue: montant.devise(), mode, note: note.value,
      });
      vibrer([10, 30, 10]);
      const message = `${formater(recu, montant.devise())} encaissés. Reste à payer : ${formater(r.reste_apres, r.devise)}.`;
      toast(message, { duree: 4500 });
      f.titre('Paiement encaissé');
      f.remplacer(h('div', { class: 'pile', style: 'text-align:center;align-items:center' },
        h('span', { class: 'cachet-ok' }, icone('coche', 30)),
        h('p', { class: 'sous-titre' }, message),
        r.reste_apres === 0 ? h('span', { class: 'badge badge-ok' }, 'Dette soldée') : null,
        h('button', { class: 'btn btn-principal btn-bloc', onclick: () => partager(texteRecuPaiement(p, client, r.paiement, r.reste_apres)) }, icone('partager', 20), 'Partager le reçu'),
        h('button', { class: 'btn btn-secondaire btn-bloc', onclick: () => f.fermer() }, 'Terminer')));
    } catch (e) { erreur(e); }
  }));

  const f = ouvrirFeuille({
    titre: `Paiement de ${client.nom}`,
    contenu: h('div', { class: 'pile' },
      devisesDues.length > 1 ? h('div', { class: 'champ' },
        h('span', { class: 'champ-libelle' }, 'Quelle dette ?'),
        segment(devisesDues.map((d) => ({ id: d, libelle: `${fm(fiche.reste[d], d)}` })), deviseDette, (d) => { deviseDette = d; construireMontant(); }, { libelle: 'Devise de la dette' })) : null,
      zoneMontant,
      h('div', { class: 'champ' },
        h('span', { class: 'champ-libelle' }, 'Reçu par'),
        puces(optionsModes(), mode, (m) => { mode = m || 'cash'; }, { libelle: 'Mode de paiement' })),
      note,
      h('p', { class: 'champ-aide' }, 'S’il y a plusieurs dettes, le paiement règle d’abord la plus ancienne.'),
      valider),
  });
  construireMontant();
}

/* ---------- Reçu de paiement ---------- */

function texteRecuPaiement(p, client, pm, resteApres) {
  return [
    `*${p.nom_boutique}*`,
    'Reçu de paiement',
    '',
    `Client : ${client.nom}`,
    `Montant payé : ${formater(pm.montant_recu, pm.devise_recue)} (${modePaiement(pm.mode)?.nom})`,
    pm.devise_recue !== pm.devise ? `Soit : ${formater(pm.montant, pm.devise)} au taux de ${formater(pm.taux, 'CDF')}` : null,
    `*Reste à payer : ${formater(resteApres, pm.devise)}*`,
    `Date : ${dateNumerique(pm.cree_le)} à ${heure(pm.cree_le)}`,
    '',
    resteApres === 0 ? 'Dette soldée. Merci !' : 'Merci !',
  ].filter((x) => x !== null).join('\n');
}

// Détail d'un paiement (depuis le journal de caisse ou un rapport).
export async function ouvrirPaiement(id) {
  const [p, x] = await Promise.all([api.profil(), api.paiement(id)]);
  if (!x) return;
  const fiche = await api.ficheClient(x.client.id);
  const ev = fiche.historique.find((e) => e.type === 'paiement' && e.paiement.id === id);
  const pm = x.paiement;
  const annulerBtn = !pm.annule_le ? h('button', { class: 'btn-texte-danger' }, 'Annuler ce paiement') : null;
  const f = ouvrirFeuille({
    titre: 'Paiement de dette',
    contenu: h('div', { class: 'pile' },
      h('div', { class: 'recu' },
        h('div', { class: 'recu-tete' },
          h('span', { class: 'icone-ronde positif' }, icone('piece', 22)),
          h('strong', { class: 'sous-titre' }, x.client.nom),
          h('span', { class: 'texte-2' }, `${libelleJour(cleJour(pm.cree_le))} · ${heure(pm.cree_le)}`),
          pm.annule_le ? h('span', { class: 'badge badge-zero' }, `Annulé à ${heure(pm.annule_le)}`) : null),
        h('div', { class: 'recu-pied' },
          h('div', { class: 'recu-ligne' }, h('span', {}, 'Montant reçu'), h('strong', { class: pm.annule_le ? 'barre-annule' : '' }, fm(pm.montant_recu, pm.devise_recue))),
          h('div', { class: 'recu-ligne' }, h('span', {}, 'Reçu par'), h('span', {}, modePaiement(pm.mode)?.nom)),
          pm.devise_recue !== pm.devise ? h('div', { class: 'recu-ligne' }, h('span', {}, 'Déduit de la dette'), h('span', {}, fm(pm.montant, pm.devise))) : null,
          h('div', { class: 'recu-ligne' }, h('span', {}, 'Reste après'), h('span', {}, fm(ev?.reste_apres ?? 0, pm.devise))),
          pm.note ? h('div', { class: 'recu-ligne' }, h('span', {}, 'Note'), h('span', {}, pm.note)) : null)),
      h('button', { class: 'btn btn-principal btn-bloc', onclick: () => partager(texteRecuPaiement(p, x.client, pm, ev?.reste_apres ?? 0)) }, icone('partager', 20), 'Partager le reçu'),
      location.hash === `#/dettes/${x.client.id}` ? null
        : h('a', { class: 'btn btn-secondaire btn-bloc', href: `#/dettes/${x.client.id}`, onclick: () => f.fermer() }, 'Voir la fiche du client'),
      h('a', { class: 'btn btn-neutre btn-bloc', href: `#/rapports/${cleJour(pm.cree_le)}`, onclick: () => f.fermer() }, icone('calendrier', 20), 'Rapport du jour'),
      annulerBtn),
  });
  annulerBtn?.addEventListener('click', enCours(annulerBtn, async () => { if (await annulerUnPaiement(pm)) f.fermer(); }));
}
