// Synchronisation appareil <-> serveur.
//
//   1. ENVOI : les opérations de la file d'attente partent dans l'ordre, une par une.
//      Chacune porte un identifiant unique : si le téléphone la renvoie (coupure pendant l'envoi),
//      le serveur ne l'applique pas deux fois. Une opération n'est retirée de la file qu'après
//      la réponse du serveur : rien ne se perd.
//   2. RÉCEPTION : les lignes modifiées sur le serveur depuis le dernier passage (autre téléphone…)
//      sont copiées sur l'appareil.
//   En cas d'échec : nouvel essai avec un délai croissant (5 s, 10 s, 20 s… jusqu'à 5 min).
//   Statut visible : « synchronise », « attente », « envoi », « horsligne », « reconnexion », « erreur », « local ».

import * as db from './db.js';
import * as serveur from './serveur.js';

const RECOUVREMENT_MS = 10000; // relit un peu avant le dernier passage (écritures simultanées)
let statut = serveur.actif() ? 'attente' : 'local';
let enAttente = 0;
let enCours = null;
let minuteur = null;
let delaiEchec = 5000;
const abonnes = new Set();
let apresReception = async () => {};

export const statutActuel = () => ({ statut, enAttente });
export const surStatut = (fn) => { abonnes.add(fn); fn(statutActuel()); return () => abonnes.delete(fn); };
export function quandRecu(fn) { apresReception = fn; }

function changer(nouveau) {
  statut = nouveau;
  document.body.dataset.sync = nouveau;
  abonnes.forEach((fn) => fn(statutActuel()));
}

// Demande une synchronisation bientôt (regroupe les opérations faites à la suite).
export function demander(delai = 400) {
  if (!serveur.actif()) return;
  clearTimeout(minuteur);
  minuteur = setTimeout(() => { synchroniser().catch(() => {}); }, delai);
}

export async function compterAttente() {
  enAttente = (await db.fileAttente()).length;
  if (statut !== 'envoi') changer(enAttente ? (navigator.onLine === false ? 'horsligne' : 'attente') : statut === 'local' ? 'local' : 'synchronise');
  return enAttente;
}

// Une seule synchronisation à la fois ; renvoie le nombre d'opérations encore en attente.
export function synchroniser() {
  if (!serveur.actif()) return Promise.resolve(0);
  if (!enCours) enCours = executer().finally(() => { enCours = null; });
  return enCours;
}

async function executer() {
  if (navigator.onLine === false) {
    await compterAttente();
    changer('horsligne');
    return enAttente;
  }
  const session = await serveur.session().catch(() => null);
  if (!session) {
    await compterAttente();
    changer('reconnexion');
    return enAttente;
  }
  try {
    // 1. Envoi
    const file = await db.fileAttente();
    enAttente = file.length;
    if (file.length) changer('envoi');
    for (const op of file) {
      await serveur.appliquerChangements(op.id, op.changes);
      await db.retirerDeLaFile(op.id);
      enAttente--;
      abonnes.forEach((fn) => fn(statutActuel()));
    }
    // 2. Réception (sauf les lignes touchées par une opération faite pendant l'envoi)
    await recevoir();
    delaiEchec = 5000;
    await compterAttente();
    changer(enAttente ? 'attente' : 'synchronise');
    if (enAttente) demander(200);
    return enAttente;
  } catch (e) {
    await compterAttente();
    changer(e.connexion ? 'reconnexion' : e.reseau ? 'horsligne' : 'erreur');
    if (!e.connexion) {
      clearTimeout(minuteur);
      minuteur = setTimeout(() => synchroniser().catch(() => {}), delaiEchec);
      delaiEchec = Math.min(delaiEchec * 2, 5 * 60 * 1000);
    }
    if (!e.reseau && !e.connexion) console.error('Synchronisation :', e);
    throw e;
  }
}

export async function recevoir({ depuisLeDebut = false } = {}) {
  const dernier = depuisLeDebut ? null : await db.lireMeta('curseur');
  const depuis = dernier ? new Date(new Date(dernier).getTime() - RECOUVREMENT_MS).toISOString() : null;
  const { changes, curseur } = await serveur.lireDepuis(depuis);
  // Ne pas écraser une ligne modifiée sur l'appareil et pas encore envoyée.
  const locaux = new Set();
  for (const op of await db.fileAttente()) for (const t of Object.keys(op.changes)) for (const r of op.changes[t]) locaux.add(t + ':' + r.id);
  let total = 0;
  for (const t of Object.keys(changes)) {
    changes[t] = changes[t].filter((r) => !locaux.has(t + ':' + r.id));
    total += changes[t].length;
  }
  if (total) {
    await db.appliquerDistant(changes);
    await apresReception();
  }
  if (curseur) await db.ecrireMeta('curseur', curseur);
  return { changes, total };
}

// Relances automatiques : retour du réseau, retour dans l'application, et toutes les minutes.
export function demarrer() {
  if (!serveur.actif()) { changer('local'); return; }
  window.addEventListener('online', () => demander(100));
  window.addEventListener('offline', () => { changer('horsligne'); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') demander(100); });
  setInterval(() => { if (document.visibilityState === 'visible') demander(0); }, 60000);
  demander(0);
}
