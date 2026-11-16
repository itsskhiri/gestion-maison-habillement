// Listes de référence partagées par le moteur et les écrans.

export const CATEGORIES = [
  { id: 'robes',       nom: 'Robes',              couleur: '#B5485F' },
  { id: 'pantalons',   nom: 'Pantalons',          couleur: '#3F5E8C' },
  { id: 'jupes',       nom: 'Jupes',              couleur: '#9466A8' },
  { id: 'chemises',    nom: 'Chemises',           couleur: '#3E8A87' },
  { id: 'tshirts',     nom: 'T-shirts',           couleur: '#C7853A' },
  { id: 'vestes',      nom: 'Vestes et manteaux', couleur: '#7A5F4C' },
  { id: 'ensembles',   nom: 'Ensembles',          couleur: '#8E7B3A' },
  { id: 'chaussures',  nom: 'Chaussures',         couleur: '#45464F' },
  { id: 'enfants',     nom: 'Enfants',            couleur: '#5C9E68' },
  { id: 'accessoires', nom: 'Accessoires',        couleur: '#B8704F' },
  { id: 'autre',       nom: 'Autre',              couleur: '#8A8790' },
];

export const TYPES_DEPENSE = [
  { id: 'marchandise', nom: 'Achat de marchandise' },
  { id: 'loyer',       nom: 'Loyer' },
  { id: 'transport',   nom: 'Transport' },
  { id: 'energie',     nom: 'Électricité / Eau' },
  { id: 'salaire',     nom: 'Salaire' },
  { id: 'autre',       nom: 'Autre' },
];

// Modes de paiement. Étape test : simple enregistrement, sans connexion aux API Mobile Money.
export const MODES = [
  { id: 'cash',   nom: 'Cash' },
  { id: 'mpesa',  nom: 'M-Pesa' },
  { id: 'airtel', nom: 'Airtel Money' },
  { id: 'orange', nom: 'Orange Money' },
];

export const FUSEAUX = [
  { id: 'Africa/Lubumbashi', nom: 'Bukavu, Goma, Lubumbashi (UTC+2)' },
  { id: 'Africa/Kinshasa',   nom: 'Kinshasa (UTC+1)' },
  { id: 'Africa/Kigali',     nom: 'Kigali (UTC+2)' },
  { id: 'Africa/Bujumbura',  nom: 'Bujumbura (UTC+2)' },
  { id: 'Africa/Kampala',    nom: 'Kampala, Nairobi (UTC+3)' },
];

export const categorie = (id) => CATEGORIES.find((c) => c.id === id) || null;
export const typeDepense = (id) => TYPES_DEPENSE.find((t) => t.id === id) || TYPES_DEPENSE[5];
export const modePaiement = (id) => MODES.find((m) => m.id === id) || null;
