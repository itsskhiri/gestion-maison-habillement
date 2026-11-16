// Montants exacts.
// Tous les montants sont des NOMBRES ENTIERS dans la plus petite unité de la devise :
//   USD -> centimes (1 250 = 12,50 $)     CDF -> francs (25 000 = 25 000 FC)
// Aucun calcul n'utilise de nombres à virgule : les arrondis sont faits en entiers.
// Le taux est un entier : nombre de FC pour 1 $.

export const DEVISES = {
  USD: { code: 'USD', symbole: '$', decimales: 2, nom: 'Dollar' },
  CDF: { code: 'CDF', symbole: 'FC', decimales: 0, nom: 'Franc congolais' },
};

export const autreDevise = (d) => (d === 'USD' ? 'CDF' : 'USD');
const facteur = (d) => 10 ** DEVISES[d].decimales;

// Division entière avec arrondi « au plus proche, moitié vers le haut ».
export function divArrondi(a, b) {
  const negatif = (a < 0) !== (b < 0);
  const x = Math.abs(a);
  const y = Math.abs(b);
  const q = Math.floor(x / y);
  const r = x - q * y;
  const res = 2 * r >= y ? q + 1 : q;
  return negatif ? -res : res;
}

// Convertit un montant (en unités) d'une devise vers une autre au taux donné.
export function convertir(unites, de, vers, taux) {
  if (de === vers) return unites;
  if (de === 'USD' && vers === 'CDF') return divArrondi(unites * taux, 100);
  if (de === 'CDF' && vers === 'USD') return divArrondi(unites * 100, taux);
  throw new Error('Devise inconnue');
}

// Écart d'arrondi maximal (dans la devise `vers`) quand un montant saisi dans la devise `de`
// est converti : un centime vaut jusqu'à taux/100 FC, un franc vaut moins d'un centime.
export function toleranceConversion(de, vers, taux) {
  if (de === vers) return 0;
  return de === 'USD' && vers === 'CDF' ? Math.ceil(taux / 100) : 1;
}

// Lit une saisie (« 12,50 », « 25 000 », « 12.5 ») et renvoie des unités entières, ou null.
export function lireMontant(texte, devise) {
  const t = String(texte ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (!t) return null;
  const dec = DEVISES[devise].decimales;
  const motif = dec ? /^\d{1,10}(\.\d{0,2})?$/ : /^\d{1,13}$/;
  if (!motif.test(t)) return null;
  const [ent, frac = ''] = t.split('.');
  return Number(ent) * facteur(devise) + Number((frac + '00').slice(0, dec) || 0);
}

// Lit un nombre entier positif (quantité, taux).
export function lireEntier(texte) {
  const t = String(texte ?? '').replace(/[\s  ]/g, '');
  return /^\d{1,9}$/.test(t) ? Number(t) : null;
}

function grouper(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Affichage : « 12,50 $ », « 25 000 FC », « −3 000 FC ».
export function formater(unites, devise, { signe = false } = {}) {
  const f = facteur(devise);
  const abs = Math.abs(unites);
  const ent = Math.floor(abs / f);
  const frac = abs - ent * f;
  let txt = grouper(ent);
  if (f > 1 && frac > 0) txt += ',' + String(frac).padStart(2, '0');
  const s = unites < 0 ? '−' : signe && unites > 0 ? '+' : '';
  return devise === 'USD' ? `${s}${txt} $` : `${s}${txt} FC`;
}

// Format court pour les axes de graphiques : « 1,2 M », « 850 k », « 40 ».
export function formaterCompact(unites, devise) {
  const v = unites / facteur(devise);
  const abs = Math.abs(v);
  const un = (x) => (Math.round(x * 10) / 10).toString().replace('.', ',');
  if (abs >= 1e6) return un(v / 1e6) + ' M';
  if (abs >= 1e3) return un(v / 1e3) + ' k';
  return un(v);
}

// Valeur à pré-remplir dans un champ de saisie : « 12,5 » -> « 12,50 », « 25000 ».
export function versSaisie(unites, devise) {
  const f = facteur(devise);
  const ent = Math.floor(unites / f);
  const frac = unites - ent * f;
  return f > 1 && frac > 0 ? `${ent},${String(frac).padStart(2, '0')}` : String(ent);
}

// Somme de montants dans plusieurs devises : { USD: 1250, CDF: 30000 } -> « 12,50 $ · 30 000 FC ».
export function formaterMulti(parDevise, principale) {
  const morceaux = ['USD', 'CDF'].filter((d) => parDevise[d]).map((d) => formater(parDevise[d], d));
  return morceaux.length ? morceaux.join(' · ') : formater(0, principale);
}
