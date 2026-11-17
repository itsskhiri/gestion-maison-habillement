// Copie locale des données dans IndexedDB (fonctionne sans internet).
// Une « table » locale = un magasin IndexedDB, avec les mêmes noms que les tables PostgreSQL.
// En plus :
//   - « file_attente » : opérations faites sur l'appareil, pas encore envoyées au serveur ;
//   - « meta »         : petites informations de synchronisation (compte, dernier envoi…).

import { TABLES, etatVide } from './moteur.js';

const NOM_BASE = 'cintre';
// Version 2 : le prix d'un article devient son prix d'achat (données v1 de test effacées).
// Version 3 : file d'attente de synchronisation et informations du compte (rien n'est effacé).
const VERSION_BASE = 3;
const FILE = 'file_attente';
const META = 'meta';
let promesse = null;
export let modeMemoire = false; // true si IndexedDB est indisponible (navigation privée très ancienne)

function ouvrir() {
  if (!promesse) {
    promesse = new Promise((resoudre, rejeter) => {
      if (!('indexedDB' in self)) { rejeter(new Error('IndexedDB indisponible')); return; }
      const req = indexedDB.open(NOM_BASE, VERSION_BASE);
      req.onupgradeneeded = (evt) => {
        const base = req.result;
        for (const t of TABLES) {
          if (!base.objectStoreNames.contains(t)) base.createObjectStore(t, { keyPath: 'id' });
          else if (evt.oldVersion < 2) req.transaction.objectStore(t).clear();
        }
        if (!base.objectStoreNames.contains(FILE)) base.createObjectStore(FILE, { keyPath: 'id' });
        if (!base.objectStoreNames.contains(META)) base.createObjectStore(META, { keyPath: 'cle' });
      };
      req.onsuccess = () => resoudre(req.result);
      req.onerror = () => rejeter(req.error);
      req.onblocked = () => rejeter(new Error('Base bloquée par un autre onglet'));
    });
  }
  return promesse;
}

const attendre = (tx) => new Promise((ok, ko) => {
  tx.oncomplete = () => ok();
  tx.onerror = () => ko(tx.error);
  tx.onabort = () => ko(tx.error || new Error('Transaction annulée'));
});
const requete = (r) => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });

export async function chargerTout() {
  const etat = etatVide();
  let base;
  try { base = await ouvrir(); } catch { modeMemoire = true; return etat; }
  const tx = base.transaction(TABLES, 'readonly');
  const lectures = TABLES.map((t) => requete(tx.objectStore(t).getAll()).then((lignes) => [t, lignes]));
  for (const [t, lignes] of await Promise.all(lectures)) {
    if (t === 'profil') etat.profil = lignes[0] || null;
    else etat[t] = lignes;
  }
  return etat;
}

// Écrit tous les changements d'une opération dans UNE transaction : tout ou rien.
// Si `operation` est donnée, elle est ajoutée à la file d'attente dans la MÊME transaction :
// une opération enregistrée sur l'appareil est forcément envoyée au serveur ensuite.
export async function enregistrer(changes, operation = null) {
  if (modeMemoire) return;
  const tables = Object.keys(changes);
  if (!tables.length) return;
  const base = await ouvrir();
  const tx = base.transaction(operation ? [...tables, FILE] : tables, 'readwrite');
  for (const t of tables) for (const rec of changes[t]) tx.objectStore(t).put(structuredClone(rec));
  if (operation) tx.objectStore(FILE).put(structuredClone(operation));
  await attendre(tx);
}

// Données reçues du serveur : remplacent les lignes locales de même identifiant.
export async function appliquerDistant(changes) {
  if (modeMemoire) return;
  const tables = Object.keys(changes).filter((t) => changes[t].length);
  if (!tables.length) return;
  const base = await ouvrir();
  const tx = base.transaction(tables, 'readwrite');
  for (const t of tables) for (const rec of changes[t]) tx.objectStore(t).put(rec);
  await attendre(tx);
}

export async function toutEffacer({ avecFile = true } = {}) {
  if (modeMemoire) return;
  const base = await ouvrir();
  const magasins = avecFile ? [...TABLES, FILE] : TABLES;
  const tx = base.transaction(magasins, 'readwrite');
  for (const t of magasins) tx.objectStore(t).clear();
  await attendre(tx);
}

/* ---------- File d'attente de synchronisation ---------- */

export async function fileAttente() {
  if (modeMemoire) return [];
  const base = await ouvrir();
  const ops = await requete(base.transaction(FILE, 'readonly').objectStore(FILE).getAll());
  return ops.sort((a, b) => a.numero - b.numero || a.cree_le.localeCompare(b.cree_le));
}

export async function retirerDeLaFile(id) {
  if (modeMemoire) return;
  const base = await ouvrir();
  const tx = base.transaction(FILE, 'readwrite');
  tx.objectStore(FILE).delete(id);
  await attendre(tx);
}

/* ---------- Informations de synchronisation ---------- */

export async function lireMeta(cle) {
  if (modeMemoire) return null;
  const base = await ouvrir();
  const r = await requete(base.transaction(META, 'readonly').objectStore(META).get(cle));
  return r ? r.valeur : null;
}

export async function ecrireMeta(cle, valeur) {
  if (modeMemoire) return;
  const base = await ouvrir();
  const tx = base.transaction(META, 'readwrite');
  if (valeur == null) tx.objectStore(META).delete(cle);
  else tx.objectStore(META).put({ cle, valeur });
  await attendre(tx);
}

// Demande au navigateur de ne pas effacer les données locales (important sur iPhone).
export async function demanderStockagePersistant() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { /* sans effet */ }
}
