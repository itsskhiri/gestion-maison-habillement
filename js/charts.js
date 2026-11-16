// Graphiques dessinés en SVG, sans librairie : courbe lissée, barres doubles, barres horizontales.
// Les valeurs sont des montants entiers (unités) ; l'affichage passe par les fonctions `format…`.

import { h } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// Repères « ronds » pour l'axe vertical (3 à 4 valeurs).
export function reperes(max) {
  if (max <= 0) return { haut: 1, valeurs: [0] };
  const brut = max / 3;
  const p = 10 ** Math.floor(Math.log10(brut));
  const n = brut / p;
  const pas = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  const haut = Math.ceil(max / pas) * pas;
  const valeurs = [];
  for (let v = 0; v <= haut + pas / 2; v += pas) valeurs.push(v);
  return { haut, valeurs };
}

// Tracé lissé sans dépassement (interpolation monotone de Fritsch-Carlson).
function cheminLisse(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  const n = pts.length;
  const d = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const t = a * a + b * b;
    if (t > 9) { const k = 3 / Math.sqrt(t); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  let c = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i + 1][0] - pts[i][0]) / 3;
    c += `C${(pts[i][0] + dx).toFixed(1)},${(pts[i][1] + m[i] * dx).toFixed(1)} ${(pts[i + 1][0] - dx).toFixed(1)},${(pts[i + 1][1] - m[i + 1] * dx).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return c;
}

function cadre(hote, hauteur) {
  // L'écran est construit avant d'être affiché : on estime alors la largeur de la carte
  // (largeur de l'écran limitée à 720 px, moins les marges de la page et de la carte).
  const estimee = Math.min(window.innerWidth, 720) - 64;
  const largeur = Math.max(240, Math.floor(hote.clientWidth || estimee));
  const svg = s('svg', { viewBox: `0 0 ${largeur} ${hauteur}`, width: largeur, height: hauteur, class: 'graphique', role: 'img' });
  return { largeur, svg };
}

// Axe vertical + lignes de grille très légères.
function grille(svg, { gauche, droite, haut, bas, largeur, hauteur, valeurs, max, formatAxe }) {
  const y = (v) => hauteur - bas - (v / max) * (hauteur - haut - bas);
  for (const v of valeurs) {
    svg.append(s('line', { x1: gauche, x2: largeur - droite, y1: y(v), y2: y(v), class: 'g-grille' }));
    const t = s('text', { x: gauche - 8, y: y(v) + 4, class: 'g-axe', 'text-anchor': 'end' });
    t.textContent = formatAxe(v);
    svg.append(t);
  }
  return y;
}

function etiquettesX(svg, points, x, hauteur, formatEtiquette, maxEtiquettes) {
  const n = points.length;
  const pas = Math.max(1, Math.ceil(n / maxEtiquettes));
  for (let i = 0; i < n; i += pas) {
    const t = s('text', { x: x(i), y: hauteur - 6, class: 'g-axe', 'text-anchor': i === 0 && n > 1 ? 'start' : 'middle' });
    t.textContent = formatEtiquette(points[i]);
    svg.append(t);
  }
}

// Info-bulle au toucher : trouve le point le plus proche du doigt.
function bulle(hote, svg, { n, x, lignes, ancrage }) {
  const info = h('div', { class: 'g-bulle', role: 'status' });
  const guide = s('line', { class: 'g-guide', y1: 8, y2: svg.viewBox.baseVal.height - 24 });
  const point = s('circle', { r: 5, class: 'g-point' });
  guide.style.display = 'none';
  point.style.display = 'none';
  svg.append(guide, point);
  hote.append(info);
  let minuteur;
  const montrer = (evt) => {
    const r = svg.getBoundingClientRect();
    const px = ((evt.clientX - r.left) / r.width) * svg.viewBox.baseVal.width;
    let i = 0;
    let best = Infinity;
    for (let k = 0; k < n; k++) { const d = Math.abs(x(k) - px); if (d < best) { best = d; i = k; } }
    const cx = x(i);
    guide.setAttribute('x1', cx);
    guide.setAttribute('x2', cx);
    guide.style.display = '';
    const cy = ancrage(i);
    if (cy != null) { point.setAttribute('cx', cx); point.setAttribute('cy', cy); point.style.display = ''; } else point.style.display = 'none';
    info.replaceChildren(...lignes(i).map((l, j) => h('div', { class: j ? 'g-bulle-valeur' : 'g-bulle-titre' }, l)));
    info.classList.add('visible');
    const gauche = (cx / svg.viewBox.baseVal.width) * r.width;
    info.style.left = `${Math.min(Math.max(gauche, 70), r.width - 70)}px`;
    clearTimeout(minuteur);
  };
  const cacher = () => {
    minuteur = setTimeout(() => { info.classList.remove('visible'); guide.style.display = 'none'; point.style.display = 'none'; }, 1800);
  };
  svg.addEventListener('pointerdown', montrer);
  svg.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse' || e.buttons || info.classList.contains('visible')) montrer(e); });
  svg.addEventListener('pointerup', cacher);
  svg.addEventListener('pointerleave', cacher);
}

// Courbe lissée avec zone remplie.
// points : [{ libelle, valeur }]
export function courbe(hote, points, { formatAxe, formatValeur, formatEtiquette, formatTitre }) {
  hote.classList.add('g-hote');
  const hauteur = 190;
  const { largeur, svg } = cadre(hote, hauteur);
  const marge = { gauche: 46, droite: 14, haut: 14, bas: 28 };
  const max0 = Math.max(0, ...points.map((p) => p.valeur));
  const { haut: max, valeurs } = reperes(max0);
  const y = grille(svg, { ...marge, largeur, hauteur, valeurs, max, formatAxe });
  const n = points.length;
  const x = (i) => (n === 1 ? (marge.gauche + largeur - marge.droite) / 2 : marge.gauche + (i / (n - 1)) * (largeur - marge.gauche - marge.droite));
  const pts = points.map((p, i) => [x(i), y(p.valeur)]);
  const trace = cheminLisse(pts);
  const base = y(0);
  svg.append(s('path', { d: `${trace}L${pts[n - 1][0].toFixed(1)},${base}L${pts[0][0].toFixed(1)},${base}Z`, class: 'g-zone' }));
  svg.append(s('path', { d: trace, class: 'g-courbe' }));
  etiquettesX(svg, points, x, hauteur, formatEtiquette, largeur < 340 ? 4 : 5);
  svg.setAttribute('aria-label', 'Évolution des ventes');
  hote.append(svg);
  bulle(hote, svg, {
    n, x,
    ancrage: (i) => pts[i][1],
    lignes: (i) => [formatTitre(points[i]), formatValeur(points[i].valeur)],
  });
}

// Barres côte à côte (entrées en vert, sorties en rouge).
// points : [{ libelle, a, b }]
export function barresDoubles(hote, points, { formatAxe, formatValeur, formatEtiquette, formatTitre, libelles }) {
  hote.classList.add('g-hote');
  const hauteur = 190;
  const { largeur, svg } = cadre(hote, hauteur);
  const marge = { gauche: 46, droite: 8, haut: 14, bas: 28 };
  const max0 = Math.max(0, ...points.map((p) => Math.max(p.a, p.b)));
  const { haut: max, valeurs } = reperes(max0);
  const y = grille(svg, { ...marge, largeur, hauteur, valeurs, max, formatAxe });
  const n = points.length;
  const pasX = (largeur - marge.gauche - marge.droite) / n;
  const x = (i) => marge.gauche + pasX * (i + 0.5);
  const lb = Math.max(1.5, Math.min(14, pasX * 0.32));
  const rayon = Math.min(3, lb / 2);
  points.forEach((p, i) => {
    for (const [v, cls, dx] of [[p.a, 'g-barre-a', -lb - 1], [p.b, 'g-barre-b', 1]]) {
      if (v <= 0) continue;
      const hy = y(v);
      svg.append(s('rect', { x: x(i) + dx, y: hy, width: lb, height: Math.max(1, y(0) - hy), rx: rayon, class: cls }));
    }
  });
  etiquettesX(svg, points, x, hauteur, formatEtiquette, largeur < 340 ? 4 : 5);
  svg.setAttribute('aria-label', 'Entrées et sorties');
  hote.append(svg);
  hote.append(h('div', { class: 'g-legende' },
    h('span', {}, h('i', { class: 'g-cle g-cle-a' }), libelles[0]),
    h('span', {}, h('i', { class: 'g-cle g-cle-b' }), libelles[1])));
  bulle(hote, svg, {
    n, x,
    ancrage: () => null,
    lignes: (i) => [formatTitre(points[i]), `${libelles[0]} : ${formatValeur(points[i].a)}`, `${libelles[1]} : ${formatValeur(points[i].b)}`],
  });
}

// Barres horizontales (ventes par catégorie). items : [{ nom, valeur, couleur }]
export function barresHorizontales(items, formatValeur) {
  const max = Math.max(1, ...items.map((i) => i.valeur));
  return h('div', { class: 'g-horiz' }, ...items.map((i) => h('div', { class: 'g-horiz-ligne' },
    h('div', { class: 'g-horiz-tete' },
      h('span', { class: 'g-horiz-nom' }, i.nom),
      h('span', { class: 'num g-horiz-valeur' }, formatValeur(i.valeur))),
    h('div', { class: 'g-horiz-piste' },
      h('div', { class: 'g-horiz-barre', style: `width:${Math.max(2, (i.valeur / max) * 100).toFixed(1)}%;${i.couleur ? `--c:${i.couleur}` : ''}` })))));
}
