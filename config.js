// Configuration générale de l'application.
// Étape 1 : aucune clé, aucun serveur. Les réglages Supabase (URL + clé publique anon)
// seront ajoutés ici à l'étape 2. Ne jamais mettre de clé secrète dans ce fichier.
export const CONFIG = {
  nomApp: 'Cintre',
  version: '0.3.2',
  fuseauParDefaut: 'Africa/Lubumbashi', // Bukavu, Goma, Lubumbashi (UTC+2)
  tauxParDefaut: 2850,                  // 1 $ = 2 850 FC, modifiable par le vendeur
  seuilStockBasParDefaut: 3,
};
