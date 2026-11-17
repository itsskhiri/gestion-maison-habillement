// Apparence : « clair » (par défaut), « sombre » ou « auto » (suit le téléphone).
// Script classique (pas un module) chargé dans <head> : le bon thème est posé avant
// l'affichage, sans clignotement. Le choix est gardé sur cet appareil.
(function () {
  var CLE = 'cintre.apparence';
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function lire() {
    try { return localStorage.getItem(CLE) || 'clair'; } catch (e) { return 'clair'; }
  }

  function appliquer(choix) {
    var sombre = choix === 'sombre' || (choix === 'auto' && media && media.matches);
    var racine = document.documentElement;
    racine.setAttribute('data-mode', sombre ? 'sombre' : 'clair');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', sombre ? '#0D0C0E' : '#F6F1EA');
  }

  window.cintreApparence = {
    lire: lire,
    choisir: function (choix) {
      try { localStorage.setItem(CLE, choix); } catch (e) { /* appareil sans stockage : choix non gardé */ }
      appliquer(choix);
    },
  };

  appliquer(lire());
  if (media && media.addEventListener) {
    media.addEventListener('change', function () { if (lire() === 'auto') appliquer('auto'); });
  }
})();
