export function exportAsPng(canvas, allElements, getBounds) {
  const bounds = getBounds(allElements);
  if (!bounds) return;

  const padding = 20;
  const offscreen = document.createElement('canvas');
  offscreen.width = bounds.width + padding * 2;
  offscreen.height = bounds.height + padding * 2;
  const ctx = offscreen.getContext('2d');

  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(0, 0, offscreen.width, offscreen.height);
  ctx.translate(-bounds.x + padding, -bounds.y + padding);

  return { canvas: offscreen, ctx, bounds };
}

export function canvasToBlob(canvas, type = 'image/png') {
  return new Promise(resolve => canvas.toBlob(resolve, type));
}

export function exportAsJson(data) {
  return JSON.stringify(data, null, 2);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  downloadBlob(blob, filename);
}
