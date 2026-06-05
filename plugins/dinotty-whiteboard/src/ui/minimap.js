export function drawMinimap(minimapCanvas, board, mainCanvasWidth, mainCanvasHeight) {
  if (!minimapCanvas) return;
  const ctx = minimapCanvas.getContext('2d');
  const W = minimapCanvas.width;
  const H = minimapCanvas.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, W, H);

  const elements = board.elements;
  if (elements.length === 0) return;

  const bounds = board.getWorldBounds(elements);
  if (!bounds) return;

  const padding = 50;
  const worldW = bounds.width + padding * 2;
  const worldH = bounds.height + padding * 2;
  const scale = Math.min(W / worldW, H / worldH);
  const offsetX = (W - worldW * scale) / 2 - bounds.x * scale + padding * scale;
  const offsetY = (H - worldH * scale) / 2 - bounds.y * scale + padding * scale;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  for (const el of elements) {
    ctx.fillStyle = el.strokeColor || '#333333';
    ctx.globalAlpha = 0.5;
    if (el.type === 'freehand') {
      if (el.points && el.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(el.x + el.points[0].x, el.y + el.points[0].y);
        for (let i = 1; i < el.points.length; i++) {
          ctx.lineTo(el.x + el.points[i].x, el.y + el.points[i].y);
        }
        ctx.strokeStyle = el.strokeColor || '#333333';
        ctx.lineWidth = 2 / scale;
        ctx.stroke();
      }
    } else {
      ctx.fillRect(el.x, el.y, el.width || 0, el.height || 0);
    }
  }

  ctx.restore();

  // Viewport indicator
  const vp = board.viewport;
  const vpX = (-vp.x / vp.zoom) * scale + offsetX;
  const vpY = (-vp.y / vp.zoom) * scale + offsetY;
  const vpW = (mainCanvasWidth / vp.zoom) * scale;
  const vpH = (mainCanvasHeight / vp.zoom) * scale;

  ctx.strokeStyle = '#1a73e8';
  ctx.lineWidth = 1;
  ctx.strokeRect(vpX, vpY, vpW, vpH);
}
