// Dates et jours, toujours calculés dans le fuseau horaire de la boutique.
// Une « clé de jour » est une chaîne 'AAAA-MM-JJ' ; une « clé de mois » est 'AAAA-MM'.

let fuseau = 'Africa/Lubumbashi';
let formateurParties = null;
const cacheJour = new Map();

function parties(date) {
  if (!formateurParties) {
    formateurParties = new Intl.DateTimeFormat('en-GB', {
      timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
  }
  const p = {};
  for (const x of formateurParties.formatToParts(date)) p[x.type] = x.value;
  return p;
}

export function definirFuseau(f) {
  if (!f || f === fuseau) return;
  try {
    new Intl.DateTimeFormat('fr', { timeZone: f });
    fuseau = f;
    formateurParties = null;
    cacheJour.clear();
  } catch { /* fuseau inconnu : on garde l'actuel */ }
}

export const maintenantIso = () => new Date().toISOString();

export function cleJour(iso) {
  let c = cacheJour.get(iso);
  if (!c) {
    const p = parties(new Date(iso));
    c = `${p.year}-${p.month}-${p.day}`;
    if (cacheJour.size > 50000) cacheJour.clear();
    cacheJour.set(iso, c);
  }
  return c;
}

export const cleMois = (iso) => cleJour(iso).slice(0, 7);
export const aujourdhui = () => cleJour(maintenantIso());

export function heure(iso) {
  const p = parties(new Date(iso));
  return `${p.hour}:${p.minute}`;
}

export const heureNumero = (iso) => Number(parties(new Date(iso)).hour);

const midi = (cle) => new Date(cle + 'T12:00:00Z');

export function ajouterJours(cle, n) {
  const d = midi(cle);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function ajouterMois(mois, n) {
  const [a, m] = mois.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export const joursEntre = (a, b) => Math.round((midi(b) - midi(a)) / 86400000);

// Date ISO correspondant à une heure locale de la boutique (utile pour les exemples et les tests).
export function isoPourJour(cle, h = 12, min = 0) {
  const [a, m, j] = cle.split('-').map(Number);
  const estime = Date.UTC(a, m - 1, j, h, min);
  const p = parties(new Date(estime));
  const vu = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(estime - (vu - estime)).toISOString();
}

const maj = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const f = (opts) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...opts });
const fmtJour = f({ weekday: 'long', day: 'numeric', month: 'long' });
const fmtJourAnnee = f({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtCourt = f({ day: 'numeric', month: 'short' });
const fmtMois = f({ month: 'long', year: 'numeric' });
const fmtMoisCourt = f({ month: 'short' });
const fmtNumerique = f({ day: '2-digit', month: '2-digit', year: 'numeric' });

// « Mardi 10 novembre » (l'année est ajoutée si ce n'est pas l'année en cours)
export function libelleJour(cle, { annee = null } = {}) {
  const avecAnnee = annee ?? cle.slice(0, 4) !== aujourdhui().slice(0, 4);
  return maj((avecAnnee ? fmtJourAnnee : fmtJour).format(midi(cle)));
}
export const libelleCourt = (cle) => fmtCourt.format(midi(cle));
export const libelleMois = (mois) => maj(fmtMois.format(midi(mois + '-01')));
export const libelleMoisCourt = (mois) => fmtMoisCourt.format(midi(mois + '-01'));
export const dateNumerique = (iso) => fmtNumerique.format(midi(cleJour(iso)));

// « aujourd'hui », « hier », « il y a 12 jours »
export function anciennete(iso) {
  const n = joursEntre(cleJour(iso), aujourdhui());
  if (n <= 0) return "aujourd'hui";
  if (n === 1) return 'hier';
  return `il y a ${n} jours`;
}
