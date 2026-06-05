import { createBaseElement } from './base.js';
import { generateId } from '../utils/id.js';
import { DEFAULTS } from '../constants.js';
import { rdpSimplify } from '../utils/simplify.js';
import { catmullRomSpline } from '../utils/smooth.js';

export function createFreehandElement(subType = 'pen') {
  const el = createBaseElement('freehand', 0, 0, 0, 0);
  el.subType = subType;
  el.points = [];
  el.smoothing = DEFAULTS.smoothing;

  switch (subType) {
    case 'marker':
      el.strokeWidth = DEFAULTS.markerWidth;
      break;
    case 'highlighter':
      el.strokeWidth = DEFAULTS.highlighterWidth;
      el.strokeColor = '#ffd700';
      break;
  }

  return el;
}

export function addPoint(el, x, y) {
  // Store element-relative points during drawing.  Bounds are calculated once
  // at finalization (finalizeFreehand) to avoid repeated shifting.
  el.points.push({ x, y });
}

export function updateBounds(el) {
  if (el.points.length === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of el.points) {
    minX = Math.min(minX, pt.x);
    minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x);
    maxY = Math.max(maxY, pt.y);
  }

  // Adjust points to be relative to new origin
  const dx = minX;
  const dy = minY;
  for (const pt of el.points) {
    pt.x -= dx;
    pt.y -= dy;
  }

  el.x += dx;
  el.y += dy;
  el.width = maxX - minX;
  el.height = maxY - minY;
}

export function finalizeFreehand(el) {
  if (el.points.length < 2) return el;

  // Simplify points (still in world-space)
  el.points = rdpSimplify(el.points, 1.5);

  // Smooth (still in world-space)
  if (el.smoothing > 0) {
    el.points = catmullRomSpline(el.points, el.smoothing, 4);
  }

  // Single bounds calculation — convert world-space points to element-relative
  updateBounds(el);
  return el;
}
