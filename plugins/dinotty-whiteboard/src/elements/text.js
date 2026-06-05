import { createBaseElement } from './base.js';
import { DEFAULTS } from '../constants.js';

export function createTextElement(x, y, content = '') {
  const el = createBaseElement('text', x, y, 200, 40);
  el.content = content;
  el.fontSize = DEFAULTS.fontSize;
  el.fontFamily = DEFAULTS.fontFamily;
  el.textAlign = 'left';
  el.backgroundColor = '#33333380';
  return el;
}

export function measureText(content, fontSize, fontFamily) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontSize}px ${fontFamily}`;

  const lines = content.split('\n');
  let maxWidth = 0;
  for (const line of lines) {
    const m = ctx.measureText(line || ' ');
    maxWidth = Math.max(maxWidth, m.width);
  }

  return {
    width: maxWidth + 16,
    height: lines.length * fontSize * 1.4 + 16,
  };
}

export function resizeTextElement(el) {
  if (!el.content) {
    el.width = 200;
    el.height = el.fontSize * 1.4 + 16;
    return;
  }
  const size = measureText(el.content, el.fontSize, el.fontFamily);
  el.width = Math.max(100, size.width);
  el.height = Math.max(el.fontSize * 1.4 + 16, size.height);
}
