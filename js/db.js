// Copie locale des données dans IndexedDB (fonctionne sans internet).
// Une « table » locale = un magasin IndexedDB, avec les mêmes noms que les tables PostgreSQL.

import { TABLES, etatVide } from './moteur.js';

const NOM_BASE = 'cintre';
// Version 2 : le prix d'un article devient son prix d'achat et le prix de vente est saisi
// à la validation. Les données de la version 1 (tests uniquement) sont effacées.
const VERSION_BASE = 2;
let promesse = null;
export let modeMemoire = false; // true si IndexedDB est indisponible (navigation privée très ancienne)

function ouvrir() {
  if (!promesse) {
    promesse = new Promise((resoudre, rejeter) => {
      if (!('indexedDB' in self)) { rejeter(new Error('IndexedDB indisponible')); return; }
      const req = indexedDB.open(NOM_BASE, VERSION_BASE);
      req.onupgradeneeded = (evt) => {
        for (const t of TABLES) {
          if (!req.result.objectStoreNames.contains(t)) req.result.createObjectStore(t, { keyPath: 'id' });
          else if (evt.oldVersion < 2) req.transaction.objectStore(t).clear();
        }
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

export async function chargerTout() {
  const etat = etatVide();
  let base;
  try { base = await ouvrir(); } catch { modeMemoire = true; return etat; }
  const tx = base.transaction(TABLES, 'readonly');
  const lectures = TABLES.map((t) => new Promise((ok, ko) => {
    const r = tx.objectStore(t).getAll();
    r.onsuccess = () => ok([t, r.result]);
    r.onerror = () => ko(r.error);
  }));
  for (const [t, lignes] of await Promise.all(lectures)) {
    if (t === 'profil') etat.profil = lignes[0] || null;
    else etat[t] = lignes;
  }
  return etat;
}

// Écrit tous les changements d'une opération dans UNE transaction : tout ou rien.
export async function enregistrer(changes) {
  if (modeMemoire) return;
  const tables = Object.keys(changes);
  if (!tables.length) return;
  const base = await ouvrir();
  const tx = base.transaction(tables, 'readwrite');
  for (const t of tables) for (const rec of changes[t]) tx.objectStore(t).put(structuredClone(rec));
  await attendre(tx);
}

export async function toutEffacer() {
  if (modeMemoire) return;
  const base = await ouvrir();
  const tx = base.transaction(TABLES, 'readwrite');
  for (const t of TABLES) tx.objectStore(t).clear();
  await attendre(tx);
}

// Demande au navigateur de ne pas effacer les données locales (important sur iPhone).
export async function demanderStockagePersistant() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { /* sans effet */ }
}
