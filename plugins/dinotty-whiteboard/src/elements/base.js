import { generateId } from '../utils/id.js';
import { DEFAULTS } from '../constants.js';

export function createBaseElement(type, x, y, width, height) {
  return {
    id: generateId(),
    type,
    x,
    y,
    width,
    height,
    rotation: 0,
    strokeColor: DEFAULTS.strokeColor,
    strokeWidth: DEFAULTS.strokeWidth,
    fillColor: DEFAULTS.fillColor,
    opacity: DEFAULTS.opacity,
    locked: false,
  };
}

export function getBounds(el) {
  return {
    x: el.x,
    y: el.y,
    width: el.width || 0,
    height: el.height || 0,
  };
}

export function moveElement(el, dx, dy) {
  el.x += dx;
  el.y += dy;
}

export function cloneElement(el) {
  const clone = JSON.parse(JSON.stringify(el));
  clone.id = generateId();
  return clone;
}
