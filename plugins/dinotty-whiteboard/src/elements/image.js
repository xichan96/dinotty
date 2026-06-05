import { createBaseElement } from './base.js';
import { generateId } from '../utils/id.js';

export function createImageElement(x, y, dataUrl, naturalWidth, naturalHeight) {
  const el = createBaseElement('image', x, y, naturalWidth, naturalHeight);
  el.dataUrl = dataUrl;
  el.naturalWidth = naturalWidth;
  el.naturalHeight = naturalHeight;
  el._img = null; // runtime Image object, not serialized
  return el;
}

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve({
        dataUrl: reader.result,
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function constrainImageSize(width, height, maxSize = 800) {
  if (width <= maxSize && height <= maxSize) return { width, height };
  const ratio = Math.min(maxSize / width, maxSize / height);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}
