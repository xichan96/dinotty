import { createBaseElement } from './base.js';

export function createRectangle(x, y, w, h, cornerRadius = 0) {
  const el = createBaseElement('rectangle', x, y, w, h);
  el.cornerRadius = cornerRadius;
  return el;
}

export function createEllipse(x, y, w, h) {
  return createBaseElement('ellipse', x, y, w, h);
}

export function createDiamond(x, y, w, h) {
  return createBaseElement('diamond', x, y, w, h);
}

export function createLine(x, y, x2, y2) {
  const el = createBaseElement('line', Math.min(x, x2), Math.min(y, y2), Math.abs(x2 - x), Math.abs(y2 - y));
  el.points = [
    { x: x - el.x, y: y - el.y },
    { x: x2 - el.x, y: y2 - el.y },
  ];
  el.endMarker = 'none';
  el.startMarker = 'none';
  return el;
}

export function createArrow(x, y, x2, y2) {
  const el = createLine(x, y, x2, y2);
  el.type = 'line';
  el.endMarker = 'arrow';
  return el;
}

export function normalizeShape(el) {
  // Ensure width/height are positive
  if (el.width < 0) {
    el.x += el.width;
    el.width = -el.width;
  }
  if (el.height < 0) {
    el.y += el.height;
    el.height = -el.height;
  }
  return el;
}
