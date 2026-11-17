// Animation d'écriture progressive (texte « tapé » lettre par lettre, curseur clignotant).
//
// Principe, pour un rendu fluide et sans à-coups :
//   - le texte complet est posé dès le départ ; la partie pas encore « tapée » est invisible
//     (visibility: hidden) : la mise en page ne bouge pas pendant l'animation ;
//   - un seul minuteur, un seul nœud texte mis à jour : très léger, même sur un vieux téléphone ;
//   - rythme naturel : un peu plus lent après une espace et une ponctuation ;
//   - à la fin, le curseur clignote un instant puis disparaît en fondu ;
//   - lecteurs d'écran : le texte complet est lu tout de suite (aria-label) ;
//   - « réduire les animations » activé sur le téléphone : texte affiché directement.

export const reduireAnimations = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Vrai pendant le dessin d'un écran qu'on vient d'ouvrir (faux quand il est seulement redessiné
// après une opération) : les titres ne s'écrivent qu'à l'arrivée sur l'écran.
export const navigation = { nouvelEcran: true };

// Titre d'écran : écrit progressivement à l'arrivée sur l'écran, affiché directement sinon.
export function titreAnime(el, texte, options = {}) {
  if (navigation.nouvelEcran) ecrire(el, texte, { delai: 120, vitesse: 42, ...options });
  else el.textContent = texte;
  return el;
}

// Montant qui « monte » jusqu'à sa valeur (à l'arrivée sur l'écran seulement).
export function compteur(el, valeur, formater, duree = 700) {
  el.textContent = formater(valeur);
  if (!navigation.nouvelEcran || reduireAnimations() || !valeur) return el;
  const debut = performance.now();
  const pas = (t) => {
    const k = Math.min(1, (t - debut) / duree);
    const facilite = 1 - (1 - k) ** 3; // ralentit en arrivant
    el.textContent = formater(Math.round(valeur * facilite));
    if (k < 1) requestAnimationFrame(pas);
  };
  requestAnimationFrame(pas);
  return el;
}

/**
 * Écrit `texte` dans `el` caractère par caractère.
 * @param {HTMLElement} el
 * @param {string} texte
 * @param {{ delai?: number, vitesse?: number }} options  delai avant de commencer (ms), vitesse moyenne (ms par lettre)
 * @returns {Promise<void>} résolue quand le texte est entièrement écrit
 */
export function ecrire(el, texte, { delai = 0, vitesse = 45 } = {}) {
  el.setAttribute('aria-label', texte);
  if (reduireAnimations()) {
    el.textContent = texte;
    return Promise.resolve();
  }
  const lettres = Array.from(texte); // respecte les lettres accentuées et les emojis
  const ecrit = document.createTextNode('');
  const curseur = document.createElement('span');
  const reste = document.createElement('span');
  curseur.className = 'ecriture-curseur ecriture-en-cours';
  reste.className = 'ecriture-reste';
  reste.textContent = texte;
  [curseur, reste].forEach((x) => x.setAttribute('aria-hidden', 'true'));
  el.replaceChildren(ecrit, curseur, reste);
  el.classList.add('ecriture');

  return new Promise((resoudre) => {
    let i = 0;
    const suivante = () => {
      i++;
      ecrit.data = lettres.slice(0, i).join('');
      reste.textContent = lettres.slice(i).join('');
      if (i >= lettres.length) { terminer(); return; }
      const c = lettres[i - 1];
      // Rythme humain : légère variation, pause après une espace ou une ponctuation.
      const pause = /[.,;:!?]/.test(c) ? vitesse * 4 : c === ' ' ? vitesse * 1.6 : vitesse * (0.7 + Math.random() * 0.6);
      setTimeout(suivante, pause);
    };
    const terminer = () => {
      reste.remove();
      curseur.classList.remove('ecriture-en-cours'); // le curseur se met à clignoter…
      setTimeout(() => {
        curseur.classList.add('ecriture-disparait'); // … puis disparaît en fondu
        setTimeout(() => { curseur.remove(); el.classList.remove('ecriture'); resoudre(); }, 450);
      }, 1100);
    };
    setTimeout(suivante, delai);
  });
}
