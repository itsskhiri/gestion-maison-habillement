# Cintre — gestion de maison d'habillement

Application web installable (PWA) pour les boutiques de vêtements, chaussures et accessoires :
ventes, stock, dettes des clients, dépenses, caisse et rapports journaliers.
Pensée d'abord pour l'iPhone (Safari), compatible Android et ordinateur.

## État d'avancement

| Étape | Contenu | État |
|---|---|---|
| 1 | Design et écrans avec données locales (sans compte ni serveur) | **Terminée** |
| 2 | Comptes, authentification, base Supabase, sécurité (RLS) | À faire |
| 3 | Caisse, dettes et rapports branchés sur la base | À faire |
| 4 | Hors-ligne et synchronisation | À faire |
| 5 | Notifications par e-mail (nécessite un nom de domaine) | À faire |
| 6 | Finitions iPhone, tests complets, version testeurs | À faire |
| B | Migration vers Node.js + PostgreSQL (seulement sur demande) | — |

## Ce que fait l'étape 1

- **Vendre** : grille d'articles avec leur **prix d'achat**, panier (bouton − sur la carte). À la validation,
  le vendeur **saisit lui-même le prix de vente** discuté avec le client, en **dollars, en francs ou les deux**
  ; le bénéfice de la vente s'affiche, avec alerte et confirmation si on vend à perte. Paiement **Cash,
  M-Pesa, Airtel Money, Orange Money**, **vente à crédit avec acompte**, reçu WhatsApp (qui ne montre
  jamais le prix d'achat), annulation, historique des ventes. Taux du jour fixé par le vendeur.
- **Articles** : nom + prix d'achat + quantité (catégorie facultative), « Ajouter un autre », nouvel
  arrivage, modification, suppression. Stock jamais négatif.
- **Dettes** : total à recevoir, fiche client (total dû / déjà payé / reste), paiement partiel,
  remboursement possible dans l'autre devise, la plus ancienne dette réglée en premier, annulation.
- **Dépenses** : montant + type en gros boutons, modification, annulation.
- **Caisse** : solde **par devise** et **par mode** (cash, M-Pesa…), ventes / encaissé / dépenses /
  bénéfice avec tendance, graphiques, ventes par catégorie, meilleures ventes, ruptures, journal.
- **Rapports par jour** : tous les jours groupés par mois, calendrier, rapport détaillé partageable.
- **Profil** : nom, devise principale, taux, fuseau, seuil de stock bas, export CSV, exemples.

Les données sont enregistrées **sur l'appareil** (IndexedDB) : chaque téléphone a ses propres données
tant que l'étape 2 (comptes + serveur) n'est pas faite.

## Règles de fiabilité

- Montants stockés en **nombres entiers** : centimes pour le dollar, francs pour le franc. Aucun calcul en
  virgule flottante. Taux = nombre entier de FC pour 1 $.
- Chaque opération enregistre **son taux** : changer le taux ne modifie jamais le passé.
- Chaque ligne de vente garde le **nom et le coût d'achat au moment de la vente**.
- **Bénéfice = ventes − prix d'achat des articles vendus − dépenses.** Les dépenses « Achat de
  marchandise » sortent de la caisse mais ne sont pas retirées du bénéfice une deuxième fois.
- Rien n'est supprimé : ventes, paiements et dépenses sont **annulés** (date et heure gardées).
- Chaque opération est vérifiée entièrement avant d'être appliquée, puis enregistrée en **une seule
  transaction** : tout réussit ou rien ne change.
- Les jours sont calculés dans le **fuseau de la boutique** (Bukavu : `Africa/Lubumbashi`, UTC+2).
- Identifiants UUID créés sur l'appareil : un même envoi répété ne crée jamais de doublon.

## Structure

```
index.html, manifest.json, sw.js, config.js, _headers
css/style.css
js/app.js          démarrage et navigation
js/api.js          SEULE porte d'accès aux données pour les écrans (à remplacer pour changer de serveur)
js/moteur.js       règles métier (même logique que les futures fonctions SQL)
js/db.js           copie locale IndexedDB
js/money.js        montants exacts et conversions $ / FC
js/temps.js        jours et heures dans le fuseau de la boutique
js/reference.js    catégories, types de dépense, modes de paiement
js/ui.js, icons.js, charts.js   interface, icônes SVG, graphiques SVG
js/accueil.js, vendre.js, articles.js, dettes.js, depenses.js, caisse.js, rapports.js, profil.js
js/exemples.js     données de démonstration
tests/             tests automatiques du moteur
```

## Lancer en local

Il faut un petit serveur (les modules JavaScript ne marchent pas en double-cliquant sur le fichier) :

```
cd "C:\Users\YVES PC\Desktop\CINTRE"
python -m http.server 8000
```

Puis ouvrir http://localhost:8000. Pour voir l'app remplie d'exemples : http://localhost:8000/?exemples

**Sur ton iPhone (même Wi-Fi)** : lance `python -m http.server 8000 --bind 0.0.0.0`, cherche l'adresse
IP du PC (`ipconfig`, ligne « Adresse IPv4 », par exemple 192.168.1.20) et ouvre
`http://192.168.1.20:8000` dans Safari. L'installation sur l'écran d'accueil et le mode hors-ligne
complet demandent HTTPS : utilise plutôt le lien Netlify ci-dessous.

## Tests

- **Moteur** (27 tests : montants, conversions, prix négocié, bénéfice, stock, dettes, acomptes, caisse, rapports) :
  lancer le serveur local puis ouvrir http://localhost:8000/tests/ — le titre doit afficher « OK ».
- Les parcours au toucher et les captures d'écran (375, 390, 430 px, clair et sombre) ont été vérifiés
  avec Playwright sur Edge.

## Mettre en ligne gratuitement (Netlify)

1. Va sur https://app.netlify.com/drop (crée un compte gratuit si besoin).
2. Glisse le dossier **CINTRE** entier dans la zone de dépôt.
3. Netlify donne un lien `https://…netlify.app` : c'est le lien à partager aux testeurs.
4. Dans *Site configuration → Change site name*, choisis un nom (par exemple `cintre-bukavu`).
5. Pour une mise à jour : onglet **Deploys**, glisse de nouveau le dossier. Pense à changer
   `VERSION` dans `sw.js` pour que les téléphones prennent la nouvelle version.

Le fichier `_headers` ajoute les protections de sécurité (HTTPS est automatique sur Netlify).

## Migrer vers PostgreSQL pur (préparation)

Dès cette étape, tout est écrit pour que le changement d'hébergeur soit simple :
- les écrans n'appellent que `js/api.js` ;
- les règles de `js/moteur.js` deviendront des fonctions SQL PostgreSQL à l'étape 2, appelées
  aujourd'hui par Supabase et demain par le serveur Node.js ;
- les tables locales ont déjà les noms des futures tables PostgreSQL.

La section complète (sauvegardes, répétition de migration, vérification) sera écrite aux étapes suivantes.
