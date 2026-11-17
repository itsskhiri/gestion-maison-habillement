// Seul fichier qui parle au serveur (Supabase en Phase A).
// Pour passer à Node.js + PostgreSQL (Phase B), on remplace ce fichier par des appels à l'API
// du serveur avec les mêmes noms de fonctions : le reste de l'application ne change pas.

import { CONFIG } from '../config.js';

// Tables lues lors de la synchronisation (« profils » côté serveur = « profil » sur l'appareil).
const TABLES_SERVEUR = ['profils', 'articles', 'clients', 'ventes', 'lignes_de_vente', 'dettes',
  'paiements_dette', 'imputations', 'depenses', 'mouvements_caisse'];
const PAGE = 1000;

let client = null;

// Le serveur est-il configuré ? (sinon : application en mode « appareil seul », comme à l'étape 1)
export const actif = () => Boolean(CONFIG.supabaseUrl && CONFIG.supabaseCleAnon && window.supabase);

function sb() {
  if (!client) {
    client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseCleAnon, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'cintre.session' },
    });
  }
  return client;
}

/* ---------- Erreurs en français ---------- */

export class ErreurServeur extends Error {
  constructor(message, { connexion = false, reseau = false } = {}) {
    super(message);
    this.name = 'ErreurMetier'; // affichée telle quelle à l'utilisateur
    this.connexion = connexion; // session expirée : il faut se reconnecter
    this.reseau = reseau;       // pas d'internet
  }
}

function traduire(err) {
  const msg = String(err?.message || err || '');
  const code = err?.status || err?.code;
  if (err instanceof TypeError || /fetch|network|Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return new ErreurServeur('Pas d’internet pour le moment. Vérifie ta connexion puis réessaie.', { reseau: true });
  }
  if (/Invalid login credentials/i.test(msg)) return new ErreurServeur('E-mail ou mot de passe incorrect.');
  if (/already registered|already been registered|User already exists/i.test(msg)) return new ErreurServeur('Cet e-mail a déjà un compte. Connecte-toi.');
  if (/Email not confirmed/i.test(msg)) return new ErreurServeur('Confirme d’abord ton e-mail : ouvre le lien reçu dans ta boîte mail.');
  if (/Password should be|at least 6|weak/i.test(msg)) return new ErreurServeur('Mot de passe trop faible : 8 caractères minimum.');
  if (/invalid.*email|Unable to validate email|email.*invalid/i.test(msg)) return new ErreurServeur('Adresse e-mail invalide.');
  if (code === 429 || /rate limit|For security purposes|too many/i.test(msg)) return new ErreurServeur('Trop de tentatives. Attends quelques minutes puis réessaie.');
  if (code === 401 || code === '28000' || /JWT|not authenticated|Non connecté|refresh token/i.test(msg)) {
    return new ErreurServeur('Ta session a expiré. Reconnecte-toi.', { connexion: true });
  }
  if (/dépasse le reste à payer/i.test(msg)) return new ErreurServeur('Le serveur a refusé un paiement plus grand que le reste à payer.');
  return new ErreurServeur('Le serveur n’a pas pu enregistrer : ' + msg);
}

async function verifier(promesse) {
  let r;
  try { r = await promesse; } catch (e) { throw traduire(e); }
  if (r.error) throw traduire(r.error);
  return r.data;
}

/* ---------- Comptes ---------- */

const adresseApp = () => location.origin + location.pathname;

export async function session() {
  const data = await verifier(sb().auth.getSession());
  return data.session;
}

// Prévient l'application des changements de connexion (connexion, déconnexion, lien « mot de passe oublié »).
export function surChangementSession(fn) {
  sb().auth.onAuthStateChange((evenement, s) => fn(evenement, s));
}

export async function creerCompte({ email, motDePasse, boutique }) {
  const data = await verifier(sb().auth.signUp({
    email, password: motDePasse,
    options: { data: { boutique }, emailRedirectTo: adresseApp() + '?confirme=1' },
  }));
  return { session: data.session, confirmationNecessaire: !data.session };
}

export async function connexion(email, motDePasse) {
  const data = await verifier(sb().auth.signInWithPassword({ email, password: motDePasse }));
  return data.session;
}

export async function deconnexion() {
  await sb().auth.signOut().catch(() => {}); // même sans internet, la session locale est effacée
}

export async function renvoyerConfirmation(email) {
  await verifier(sb().auth.resend({ type: 'signup', email, options: { emailRedirectTo: adresseApp() + '?confirme=1' } }));
}

export async function motDePasseOublie(email) {
  await verifier(sb().auth.resetPasswordForEmail(email, { redirectTo: adresseApp() + '?reinitialisation=1' }));
}

export async function changerMotDePasse(motDePasse) {
  await verifier(sb().auth.updateUser({ password: motDePasse }));
}

/* ---------- Données ---------- */

// Envoie une opération (ses lignes modifiées). Le serveur l'applique en une transaction, une seule fois.
export async function appliquerChangements(id, changes) {
  const corps = { ...changes };
  await verifier(sb().rpc('appliquer_changements', { p_operation: id, p_changements: corps }));
}

// Lignes modifiées sur le serveur depuis `depuis` (date ISO), toutes tables.
// Renvoie { changes: { table: [lignes] }, curseur: date de la dernière modification reçue }.
export async function lireDepuis(depuis) {
  const changes = {};
  let curseur = depuis;
  for (const t of TABLES_SERVEUR) {
    const lignes = [];
    for (let debut = 0; ; debut += PAGE) {
      let q = sb().from(t).select('*').order('maj_le', { ascending: true }).range(debut, debut + PAGE - 1);
      if (depuis) q = q.gt('maj_le', depuis);
      const page = await verifier(q);
      lignes.push(...page);
      if (page.length < PAGE) break;
    }
    for (const l of lignes) if (!curseur || l.maj_le > curseur) curseur = l.maj_le;
    if (t === 'profils') changes.profil = lignes.map((l) => ({ ...l, id: 'profil' }));
    else changes[t] = lignes;
  }
  return { changes, curseur };
}

export async function effacerMesDonnees(garderBoutique) {
  await verifier(sb().rpc('effacer_mes_donnees', { p_garder_boutique: garderBoutique }));
}

export async function supprimerMonCompte() {
  await verifier(sb().rpc('supprimer_mon_compte'));
  await deconnexion();
}
