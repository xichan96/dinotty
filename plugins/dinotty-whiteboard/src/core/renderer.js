import { LIMITS } from '../constants.js';

export class Renderer {
  constructor(canvas, viewport) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.viewport = viewport;
    this.showGrid = true;
  }

  clear(w, h) {
    this.ctx.clearRect(0, 0, w, h);
  }

  drawBackground(w, h) {
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, w, h);
  }

  drawGrid(w, h) {
    if (!this.showGrid) return;
    const { ctx, viewport } = this;
    const gridSize = LIMITS.gridSize;
    const zoom = viewport.zoom;
    if (zoom < 0.15) return;

    ctx.save();

    // Visible world-space bounds
    const worldLeft = -viewport.x / zoom;
    const worldTop = -viewport.y / zoom;
    const worldRight = worldLeft + w / zoom;
    const worldBottom = worldTop + h / zoom;

    // First grid line at or before the visible edge
    const startX = Math.floor(worldLeft / gridSize) * gridSize;
    const startY = Math.floor(worldTop / gridSize) * gridSize;

    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();

    for (let x = startX; x <= worldRight; x += gridSize) {
      ctx.moveTo(x, worldTop);
      ctx.lineTo(x, worldBottom);
    }
    for (let y = startY; y <= worldBottom; y += gridSize) {
      ctx.moveTo(worldLeft, y);
      ctx.lineTo(worldRight, y);
    }
    ctx.stroke();

    ctx.restore();
  }

  renderElement(el) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = el.opacity ?? 1;

    if (el.rotation) {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate(el.rotation);
      ctx.translate(-cx, -cy);
    }

    switch (el.type) {
      case 'freehand': this.renderFreehand(el); break;
      case 'rectangle': this.renderRectangle(el); break;
      case 'ellipse': this.renderEllipse(el); break;
      case 'diamond': this.renderDiamond(el); break;
      case 'line': this.renderLine(el); break;
      case 'text': this.renderText(el); break;
      case 'image': this.renderImage(el); break;
    }

    ctx.restore();
  }

  renderFreehand(el) {
    const { ctx } = this;
    if (!el.points || el.points.length < 2) return;

    let strokeColor = el.strokeColor || '#333333';
    let lineWidth = el.strokeWidth || 2;
    let globalAlpha = 1;

    switch (el.subType) {
      case 'marker':
        lineWidth = (el.strokeWidth || 2) * 6;
        globalAlpha = 0.4;
        break;
      case 'highlighter':
        lineWidth = (el.strokeWidth || 2) * 10;
        globalAlpha = 0.3;
        strokeColor = el.strokeColor || '#ffd700';
        break;
      case 'eraser':
        return;
    }

    ctx.globalAlpha *= globalAlpha;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(el.x + el.points[0].x, el.y + el.points[0].y);
    for (let i = 1; i < el.points.length; i++) {
      ctx.lineTo(el.x + el.points[i].x, el.y + el.points[i].y);
    }
    ctx.stroke();
  }

  renderRectangle(el) {
    const { ctx } = this;
    const r = el.cornerRadius || 0;

    if (el.fillColor) {
      ctx.fillStyle = el.fillColor;
      this.roundRect(el.x, el.y, el.width, el.height, r);
      ctx.fill();
    }

    ctx.strokeStyle = el.strokeColor || '#333333';
    ctx.lineWidth = el.strokeWidth || 2;
    this.roundRect(el.x, el.y, el.width, el.height, r);
    ctx.stroke();
  }

  renderEllipse(el) {
    const { ctx } = this;
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const rx = Math.abs(el.width / 2);
    const ry = Math.abs(el.height / 2);

    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);

    if (el.fillColor) {
      ctx.fillStyle = el.fillColor;
      ctx.fill();
    }

    ctx.strokeStyle = el.strokeColor || '#333333';
    ctx.lineWidth = el.strokeWidth || 2;
    ctx.stroke();
  }

  renderDiamond(el) {
    const { ctx } = this;
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;

    ctx.beginPath();
    ctx.moveTo(cx, el.y);
    ctx.lineTo(el.x + el.width, cy);
    ctx.lineTo(cx, el.y + el.height);
    ctx.lineTo(el.x, cy);
    ctx.closePath();

    if (el.fillColor) {
      ctx.fillStyle = el.fillColor;
      ctx.fill();
    }

    ctx.strokeStyle = el.strokeColor || '#333333';
    ctx.lineWidth = el.strokeWidth || 2;
    ctx.stroke();
  }

  renderLine(el) {
    const { ctx } = this;
    if (!el.points || el.points.length < 2) return;

    const [p0, p1] = el.points;
    const x1 = el.x + p0.x, y1 = el.y + p0.y;
    const x2 = el.x + p1.x, y2 = el.y + p1.y;

    ctx.strokeStyle = el.strokeColor || '#333333';
    ctx.lineWidth = el.strokeWidth || 2;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    if (el.endMarker && el.endMarker !== 'none') this.drawMarker(x2, y2, x1, y1, el.endMarker, el.strokeColor, el.strokeWidth);
    if (el.startMarker && el.startMarker !== 'none') this.drawMarker(x1, y1, x2, y2, el.startMarker, el.strokeColor, el.strokeWidth);
  }

  drawMarker(toX, toY, fromX, fromY, type, color, width) {
    const { ctx } = this;
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const size = (width || 2) * 4;

    ctx.save();
    ctx.fillStyle = color || '#333333';
    ctx.translate(toX, toY);
    ctx.rotate(angle);

    if (type === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-size, -size / 2);
      ctx.lineTo(-size, size / 2);
      ctx.closePath();
      ctx.fill();
    } else if (type === 'dot') {
      ctx.beginPath();
      ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  renderText(el) {
    const { ctx } = this;
    if (!el.content) return;

    const fontSize = el.fontSize || 16;
    const fontFamily = el.fontFamily || 'sans-serif';

    if (el.backgroundColor) {
      ctx.fillStyle = el.backgroundColor;
      ctx.fillRect(el.x, el.y, el.width, el.height);
    }

    ctx.fillStyle = el.strokeColor || '#333333';
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textBaseline = 'top';

    const align = el.textAlign || 'left';
    ctx.textAlign = align;

    const textX = align === 'center' ? el.x + el.width / 2
      : align === 'right' ? el.x + el.width
      : el.x + 4;

    const maxWidth = el.width - 8;
    const lines = this.wrapText(el.content, maxWidth);
    const lineHeight = fontSize * 1.4;

    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], textX, el.y + 4 + i * lineHeight);
    }
  }

  wrapText(text, maxWidth) {
    const { ctx } = this;
    const paragraphs = text.split('\n');
    const result = [];

    for (const paragraph of paragraphs) {
      if (!paragraph) { result.push(''); continue; }
      const words = paragraph.split(/\s+/);
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(testLine).width > maxWidth && currentLine) {
          result.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) result.push(currentLine);
    }

    return result.length ? result : [''];
  }

  renderImage(el) {
    if (!el._img || !el._img.complete) {
      if (!el._img && el.dataUrl) {
        el._img = new Image();
        el._img.src = el.dataUrl;
        el._img.onload = () => { this._needsRedraw = true; };
      }
      return;
    }
    this.ctx.drawImage(el._img, el.x, el.y, el.width, el.height);
  }

  drawSelectionHandles(el, zoom) {
    const { ctx } = this;
    const handles = this.getHandles(el);
    const size = 6 / zoom;

    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 1.5 / zoom;
    ctx.strokeRect(el.x, el.y, el.width, el.height);

    ctx.fillStyle = '#ffffff';
    for (const h of handles) {
      ctx.fillRect(h.x - size / 2, h.y - size / 2, size, size);
      ctx.strokeRect(h.x - size / 2, h.y - size / 2, size, size);
    }
  }

  getHandles(el) {
    const { x, y, width: w, height: h } = el;
    return [
      { x, y, cursor: 'nw-resize', pos: 'tl' },
      { x: x + w / 2, y, cursor: 'n-resize', pos: 'tc' },
      { x: x + w, y, cursor: 'ne-resize', pos: 'tr' },
      { x: x + w, y: y + h / 2, cursor: 'e-resize', pos: 'mr' },
      { x: x + w, y: y + h, cursor: 'se-resize', pos: 'br' },
      { x: x + w / 2, y: y + h, cursor: 's-resize', pos: 'bc' },
      { x, y: y + h, cursor: 'sw-resize', pos: 'bl' },
      { x, y: y + h / 2, cursor: 'w-resize', pos: 'ml' },
    ];
  }

  roundRect(x, y, w, h, r) {
    const { ctx } = this;
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
