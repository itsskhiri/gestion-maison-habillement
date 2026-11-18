// Configuration générale de l'application.
// Serveur Supabase : URL du projet + clé PUBLIQUE « anon » (faite pour être visible ; la sécurité
// par ligne protège les données). Laisser vides pour utiliser l'application sur l'appareil seul.
// Ne JAMAIS mettre ici la clé secrète « service_role ».
export const CONFIG = {
  supabaseUrl: 'https://lbcrrblgcojrnvmmshyr.supabase.co',
  supabaseCleAnon: 'sb_publishable_DJf3E6_RVyCrDyQu81UTng_BHPanrCF',
  nomApp: 'Cintre',
  version: '0.8.1',
  fuseauParDefaut: 'Africa/Lubumbashi', // Bukavu, Goma, Lubumbashi (UTC+2)
  tauxParDefaut: 2850,                  // 1 $ = 2 850 FC, modifiable par le vendeur
  seuilStockBasParDefaut: 3,
};
