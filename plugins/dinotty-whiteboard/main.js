// src/constants.js
var DEFAULTS = {
  strokeColor: "#333333",
  strokeWidth: 2,
  fillColor: null,
  opacity: 1,
  fontSize: 16,
  fontFamily: "sans-serif",
  cornerRadius: 0,
  smoothing: 0.5,
  eraserRadius: 10,
  markerWidth: 12,
  highlighterWidth: 20,
  highlighterOpacity: 0.3,
  markerOpacity: 0.4
};
var LIMITS = {
  zoom: { min: 0.1, max: 5 },
  history: 50,
  gridSize: 20
};
var COLORS = [
  "#e0e0e0",
  "#ffffff",
  "#ff0000",
  "#ff6b00",
  "#ffd700",
  "#00cc00",
  "#0099ff",
  "#9966ff",
  "#ff66cc",
  "#00cccc",
  "#ff4444",
  "#44ff44",
  "#4444ff",
  "#888888",
  "#444444"
];
var FILL_COLORS = [
  null,
  "#ff000030",
  "#ff6b0030",
  "#ffd70030",
  "#00cc0030",
  "#0099ff30",
  "#9966ff30",
  "#ff66cc30",
  "#00cccc30",
  "#ffffff20",
  "#00000020"
];
var STROKE_WIDTHS = [1, 2, 3, 5, 8];

// src/core/viewport.js
var Viewport = class {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
  }
  set(x, y, zoom) {
    this.x = x;
    this.y = y;
    this.zoom = Math.max(LIMITS.zoom.min, Math.min(LIMITS.zoom.max, zoom));
  }
  pan(dx, dy) {
    this.x += dx;
    this.y += dy;
  }
  zoomAt(cx, cy, delta) {
    const oldZoom = this.zoom;
    const factor = Math.pow(1.002, -delta);
    this.zoom = Math.max(LIMITS.zoom.min, Math.min(LIMITS.zoom.max, this.zoom * factor));
    const ratio = this.zoom / oldZoom;
    this.x = cx - (cx - this.x) * ratio;
    this.y = cy - (cy - this.y) * ratio;
  }
  reset() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
  }
  // Convert screen coordinates to world coordinates
  screenToWorld(sx, sy) {
    return {
      x: (sx - this.x) / this.zoom,
      y: (sy - this.y) / this.zoom
    };
  }
  // Convert world coordinates to screen coordinates
  worldToScreen(wx, wy) {
    return {
      x: wx * this.zoom + this.x,
      y: wy * this.zoom + this.y
    };
  }
  applyTransform(ctx) {
    ctx.translate(this.x, this.y);
    ctx.scale(this.zoom, this.zoom);
  }
  serialize() {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }
  deserialize(data) {
    if (data) {
      this.x = data.x || 0;
      this.y = data.y || 0;
      this.zoom = data.zoom || 1;
    }
  }
};

// src/core/history.js
var History = class {
  constructor() {
    this.stack = [];
    this.index = -1;
    this.maxSteps = LIMITS.history;
  }
  push(snapshot) {
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(JSON.parse(JSON.stringify(snapshot)));
    if (this.stack.length > this.maxSteps) {
      this.stack.shift();
    } else {
      this.index++;
    }
  }
  undo() {
    if (this.index > 0) {
      this.index--;
      return JSON.parse(JSON.stringify(this.stack[this.index]));
    }
    return null;
  }
  redo() {
    if (this.index < this.stack.length - 1) {
      this.index++;
      return JSON.parse(JSON.stringify(this.stack[this.index]));
    }
    return null;
  }
  canUndo() {
    return this.index > 0;
  }
  canRedo() {
    return this.index < this.stack.length - 1;
  }
  clear() {
    this.stack = [];
    this.index = -1;
  }
  // Get current snapshot
  current() {
    if (this.index >= 0 && this.index < this.stack.length) {
      return JSON.parse(JSON.stringify(this.stack[this.index]));
    }
    return null;
  }
};

// src/core/renderer.js
var Renderer = class {
  constructor(canvas, viewport) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.viewport = viewport;
    this.showGrid = true;
  }
  clear(w, h) {
    this.ctx.clearRect(0, 0, w, h);
  }
  drawBackground(w, h) {
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, w, h);
  }
  drawGrid(w, h) {
    if (!this.showGrid) return;
    const { ctx, viewport } = this;
    const gridSize = LIMITS.gridSize;
    const zoom = viewport.zoom;
    if (zoom < 0.15) return;
    ctx.save();
    const worldLeft = -viewport.x / zoom;
    const worldTop = -viewport.y / zoom;
    const worldRight = worldLeft + w / zoom;
    const worldBottom = worldTop + h / zoom;
    const startX = Math.floor(worldLeft / gridSize) * gridSize;
    const startY = Math.floor(worldTop / gridSize) * gridSize;
    ctx.strokeStyle = "rgba(0,0,0,0.06)";
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
      case "freehand":
        this.renderFreehand(el);
        break;
      case "rectangle":
        this.renderRectangle(el);
        break;
      case "ellipse":
        this.renderEllipse(el);
        break;
      case "diamond":
        this.renderDiamond(el);
        break;
      case "line":
        this.renderLine(el);
        break;
      case "text":
        this.renderText(el);
        break;
      case "image":
        this.renderImage(el);
        break;
    }
    ctx.restore();
  }
  renderFreehand(el) {
    const { ctx } = this;
    if (!el.points || el.points.length < 2) return;
    let strokeColor = el.strokeColor || "#333333";
    let lineWidth = el.strokeWidth || 2;
    let globalAlpha = 1;
    switch (el.subType) {
      case "marker":
        lineWidth = (el.strokeWidth || 2) * 6;
        globalAlpha = 0.4;
        break;
      case "highlighter":
        lineWidth = (el.strokeWidth || 2) * 10;
        globalAlpha = 0.3;
        strokeColor = el.strokeColor || "#ffd700";
        break;
      case "eraser":
        return;
    }
    ctx.globalAlpha *= globalAlpha;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
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
    ctx.strokeStyle = el.strokeColor || "#333333";
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
    ctx.strokeStyle = el.strokeColor || "#333333";
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
    ctx.strokeStyle = el.strokeColor || "#333333";
    ctx.lineWidth = el.strokeWidth || 2;
    ctx.stroke();
  }
  renderLine(el) {
    const { ctx } = this;
    if (!el.points || el.points.length < 2) return;
    const [p0, p1] = el.points;
    const x1 = el.x + p0.x, y1 = el.y + p0.y;
    const x2 = el.x + p1.x, y2 = el.y + p1.y;
    ctx.strokeStyle = el.strokeColor || "#333333";
    ctx.lineWidth = el.strokeWidth || 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (el.endMarker && el.endMarker !== "none") this.drawMarker(x2, y2, x1, y1, el.endMarker, el.strokeColor, el.strokeWidth);
    if (el.startMarker && el.startMarker !== "none") this.drawMarker(x1, y1, x2, y2, el.startMarker, el.strokeColor, el.strokeWidth);
  }
  drawMarker(toX, toY, fromX, fromY, type, color, width) {
    const { ctx } = this;
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const size = (width || 2) * 4;
    ctx.save();
    ctx.fillStyle = color || "#333333";
    ctx.translate(toX, toY);
    ctx.rotate(angle);
    if (type === "arrow") {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-size, -size / 2);
      ctx.lineTo(-size, size / 2);
      ctx.closePath();
      ctx.fill();
    } else if (type === "dot") {
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
    const fontFamily = el.fontFamily || "sans-serif";
    if (el.backgroundColor) {
      ctx.fillStyle = el.backgroundColor;
      ctx.fillRect(el.x, el.y, el.width, el.height);
    }
    ctx.fillStyle = el.strokeColor || "#333333";
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textBaseline = "top";
    const align = el.textAlign || "left";
    ctx.textAlign = align;
    const textX = align === "center" ? el.x + el.width / 2 : align === "right" ? el.x + el.width : el.x + 4;
    const maxWidth = el.width - 8;
    const lines = this.wrapText(el.content, maxWidth);
    const lineHeight = fontSize * 1.4;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], textX, el.y + 4 + i * lineHeight);
    }
  }
  wrapText(text, maxWidth) {
    const { ctx } = this;
    const paragraphs = text.split("\n");
    const result = [];
    for (const paragraph of paragraphs) {
      if (!paragraph) {
        result.push("");
        continue;
      }
      const words = paragraph.split(/\s+/);
      let currentLine = "";
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
    return result.length ? result : [""];
  }
  renderImage(el) {
    if (!el._img || !el._img.complete) {
      if (!el._img && el.dataUrl) {
        el._img = new Image();
        el._img.src = el.dataUrl;
        el._img.onload = () => {
          this._needsRedraw = true;
        };
      }
      return;
    }
    this.ctx.drawImage(el._img, el.x, el.y, el.width, el.height);
  }
  drawSelectionHandles(el, zoom) {
    const { ctx } = this;
    const handles = this.getHandles(el);
    const size = 6 / zoom;
    ctx.strokeStyle = "#4a9eff";
    ctx.lineWidth = 1.5 / zoom;
    ctx.strokeRect(el.x, el.y, el.width, el.height);
    ctx.fillStyle = "#ffffff";
    for (const h of handles) {
      ctx.fillRect(h.x - size / 2, h.y - size / 2, size, size);
      ctx.strokeRect(h.x - size / 2, h.y - size / 2, size, size);
    }
  }
  getHandles(el) {
    const { x, y, width: w, height: h } = el;
    return [
      { x, y, cursor: "nw-resize", pos: "tl" },
      { x: x + w / 2, y, cursor: "n-resize", pos: "tc" },
      { x: x + w, y, cursor: "ne-resize", pos: "tr" },
      { x: x + w, y: y + h / 2, cursor: "e-resize", pos: "mr" },
      { x: x + w, y: y + h, cursor: "se-resize", pos: "br" },
      { x: x + w / 2, y: y + h, cursor: "s-resize", pos: "bc" },
      { x, y: y + h, cursor: "sw-resize", pos: "bl" },
      { x, y: y + h / 2, cursor: "w-resize", pos: "ml" }
    ];
  }
  roundRect(x, y, w, h, r) {
    const { ctx } = this;
    if (w < 0) {
      x += w;
      w = -w;
    }
    if (h < 0) {
      y += h;
      h = -h;
    }
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
};

// src/elements/hitTest.js
var HitTest = class {
  pointTest(point, elements) {
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (this.hitElement(point, el)) {
        return el;
      }
    }
    return null;
  }
  rectTest(rect, elements) {
    const selected = [];
    for (const el of elements) {
      if (this.intersects(rect, el)) {
        selected.push(el);
      }
    }
    return selected;
  }
  hitElement(point, el) {
    switch (el.type) {
      case "freehand":
        return this.hitFreehand(point, el);
      case "line":
        return this.hitLine(point, el);
      case "text":
      case "rectangle":
      case "ellipse":
      case "diamond":
      case "image":
        return this.hitBBox(point, el);
      default:
        return false;
    }
  }
  hitBBox(point, el) {
    return point.x >= el.x && point.x <= el.x + el.width && point.y >= el.y && point.y <= el.y + el.height;
  }
  hitFreehand(point, el) {
    if (!this.hitBBox(point, el)) return false;
    const threshold = (el.strokeWidth || 2) * 3;
    for (let i = 0; i < el.points.length - 1; i++) {
      const p0 = { x: el.x + el.points[i].x, y: el.y + el.points[i].y };
      const p1 = { x: el.x + el.points[i + 1].x, y: el.y + el.points[i + 1].y };
      if (this.distToSegment(point, p0, p1) < threshold) {
        return true;
      }
    }
    return false;
  }
  hitLine(point, el) {
    if (!el.points || el.points.length < 2) return false;
    const p0 = { x: el.x + el.points[0].x, y: el.y + el.points[0].y };
    const p1 = { x: el.x + el.points[1].x, y: el.y + el.points[1].y };
    const threshold = (el.strokeWidth || 2) * 3 + 5;
    return this.distToSegment(point, p0, p1) < threshold;
  }
  handleTest(point, handles, zoom) {
    const size = 8 / zoom;
    for (const h of handles) {
      if (Math.abs(point.x - h.x) < size && Math.abs(point.y - h.y) < size) {
        return h;
      }
    }
    return null;
  }
  distToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
      const ex2 = p.x - a.x;
      const ey2 = p.y - a.y;
      return Math.sqrt(ex2 * ex2 + ey2 * ey2);
    }
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    const ex = p.x - projX;
    const ey = p.y - projY;
    return Math.sqrt(ex * ex + ey * ey);
  }
  intersects(rect, el) {
    const ex = el.x;
    const ey = el.y;
    const ew = el.width || 0;
    const eh = el.height || 0;
    return !(rect.x > ex + ew || rect.x + rect.width < ex || rect.y > ey + eh || rect.y + rect.height < ey);
  }
};

// src/tools/selectTool.js
var SelectTool = class {
  constructor(board) {
    this.board = board;
    this._dragging = false;
    this._resizing = false;
    this._selecting = false;
    this._startPoint = null;
    this._lastPoint = null;
    this._resizeHandle = null;
    this._resizeStartBounds = null;
    this._selectionRect = null;
  }
  onPointerDown(point, e) {
    const { board } = this;
    const renderer = board.renderer;
    for (const el of board.getSelectedElements()) {
      const handles = renderer.getHandles(el);
      const handle = board.hitTest.handleTest(point, handles, board.viewport.zoom);
      if (handle) {
        this._resizing = true;
        this._resizeHandle = handle;
        this._startPoint = point;
        this._resizeStartBounds = { x: el.x, y: el.y, width: el.width, height: el.height };
        this._resizeTarget = el;
        return;
      }
    }
    const hit = board.hitTest.pointTest(point, board.elements);
    if (hit) {
      if (e.shiftKey) {
        board.toggleSelection(hit.id);
      } else if (!board.selectedIds.has(hit.id)) {
        board.selectElement(hit.id);
      }
      this._dragging = true;
      this._startPoint = point;
      this._lastPoint = point;
    } else {
      if (!e.shiftKey) {
        board.clearSelection();
      }
      this._selecting = true;
      this._startPoint = point;
      this._selectionRect = { x: point.x, y: point.y, width: 0, height: 0 };
    }
  }
  onPointerMove(point, e) {
    const { board } = this;
    if (this._resizing && this._resizeTarget) {
      this._handleResize(point, e.shiftKey);
      return;
    }
    if (this._dragging && this._startPoint && this._lastPoint) {
      const dx = point.x - this._lastPoint.x;
      const dy = point.y - this._lastPoint.y;
      for (const el of board.getSelectedElements()) {
        el.x += dx;
        el.y += dy;
      }
      this._lastPoint = point;
      board.markDirty();
      return;
    }
    if (this._selecting && this._startPoint) {
      this._selectionRect = {
        x: Math.min(this._startPoint.x, point.x),
        y: Math.min(this._startPoint.y, point.y),
        width: Math.abs(point.x - this._startPoint.x),
        height: Math.abs(point.y - this._startPoint.y)
      };
      board.markDirty();
    }
  }
  onPointerUp(point, e) {
    const { board } = this;
    if (this._dragging) {
      board.history.push(board.elements);
      board.scheduleSave();
    }
    if (this._resizing) {
      board.history.push(board.elements);
      board.scheduleSave();
    }
    if (this._selecting && this._selectionRect) {
      const selected = board.hitTest.rectTest(this._selectionRect, board.elements);
      for (const el of selected) {
        board.addToSelection(el.id);
      }
    }
    this._dragging = false;
    this._resizing = false;
    this._selecting = false;
    this._startPoint = null;
    this._lastPoint = null;
    this._resizeHandle = null;
    this._resizeTarget = null;
    this._selectionRect = null;
    board.markDirty();
  }
  _handleResize(point, constrain) {
    const el = this._resizeTarget;
    const handle = this._resizeHandle;
    const start = this._resizeStartBounds;
    const dx = point.x - this._startPoint.x;
    const dy = point.y - this._startPoint.y;
    let newX = start.x;
    let newY = start.y;
    let newW = start.width;
    let newH = start.height;
    switch (handle.pos) {
      case "tl":
        newX = start.x + dx;
        newY = start.y + dy;
        newW = start.width - dx;
        newH = start.height - dy;
        break;
      case "tc":
        newY = start.y + dy;
        newH = start.height - dy;
        break;
      case "tr":
        newY = start.y + dy;
        newW = start.width + dx;
        newH = start.height - dy;
        break;
      case "mr":
        newW = start.width + dx;
        break;
      case "br":
        newW = start.width + dx;
        newH = start.height + dy;
        break;
      case "bc":
        newH = start.height + dy;
        break;
      case "bl":
        newX = start.x + dx;
        newW = start.width - dx;
        newH = start.height + dy;
        break;
      case "ml":
        newX = start.x + dx;
        newW = start.width - dx;
        break;
    }
    if (constrain) {
      const size = Math.max(Math.abs(newW), Math.abs(newH));
      newW = size * Math.sign(newW || 1);
      newH = size * Math.sign(newH || 1);
    }
    if (Math.abs(newW) < 2) newW = 2 * Math.sign(newW || 1);
    if (Math.abs(newH) < 2) newH = 2 * Math.sign(newH || 1);
    el.x = newX;
    el.y = newY;
    el.width = newW;
    el.height = newH;
    this.board.markDirty();
  }
};

// src/utils/id.js
function generateId() {
  return crypto.randomUUID();
}

// src/elements/base.js
function createBaseElement(type, x, y, width, height) {
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
    locked: false
  };
}

// src/utils/simplify.js
function rdpSimplify(points, epsilon = 1.5) {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = rdpSimplify(points.slice(0, maxIdx + 1), epsilon);
    const right = rdpSimplify(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}
function perpendicularDistance(point, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex2 = point.x - lineStart.x;
    const ey2 = point.y - lineStart.y;
    return Math.sqrt(ex2 * ex2 + ey2 * ey2);
  }
  const t = Math.max(0, Math.min(
    1,
    ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq
  ));
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;
  const ex = point.x - projX;
  const ey = point.y - projY;
  return Math.sqrt(ex * ex + ey * ey);
}

// src/utils/smooth.js
function catmullRomSpline(points, tension = 0.5, numSegments = 8) {
  if (points.length < 2) return points;
  if (points.length === 2) return points;
  const result = [];
  result.push(points[0]);
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[Math.min(points.length - 1, i + 1)];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let t = 1; t <= numSegments; t++) {
      const s = t / numSegments;
      const s2 = s * s;
      const s3 = s2 * s;
      const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * s + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s3);
      const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * s + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s3);
      result.push({ x, y });
    }
  }
  return result;
}

// src/elements/freehand.js
function createFreehandElement(subType = "pen") {
  const el = createBaseElement("freehand", 0, 0, 0, 0);
  el.subType = subType;
  el.points = [];
  el.smoothing = DEFAULTS.smoothing;
  switch (subType) {
    case "marker":
      el.strokeWidth = DEFAULTS.markerWidth;
      break;
    case "highlighter":
      el.strokeWidth = DEFAULTS.highlighterWidth;
      el.strokeColor = "#ffd700";
      break;
  }
  return el;
}
function addPoint(el, x, y) {
  el.points.push({ x, y });
}
function updateBounds(el) {
  if (el.points.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of el.points) {
    minX = Math.min(minX, pt.x);
    minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x);
    maxY = Math.max(maxY, pt.y);
  }
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
function finalizeFreehand(el) {
  if (el.points.length < 2) return el;
  el.points = rdpSimplify(el.points, 1.5);
  if (el.smoothing > 0) {
    el.points = catmullRomSpline(el.points, el.smoothing, 4);
  }
  updateBounds(el);
  return el;
}

// src/tools/penTool.js
var PenTool = class {
  constructor(board, subType = "pen") {
    this.board = board;
    this.subType = subType;
    this._element = null;
    this._lastPoint = null;
    this._throttleMs = 16;
    this._lastTime = 0;
  }
  onPointerDown(point, e) {
    this._element = createFreehandElement(this.subType);
    this._element.x = point.x;
    this._element.y = point.y;
    if (this.subType === "pen") {
      if (this.board.currentStrokeWidth) this._element.strokeWidth = this.board.currentStrokeWidth;
      if (this.board.currentStrokeColor) this._element.strokeColor = this.board.currentStrokeColor;
    }
    addPoint(this._element, 0, 0);
    this._lastPoint = point;
    this._lastTime = Date.now();
    this.board.setDrawingElement(this._element);
  }
  onPointerMove(point, e) {
    if (!this._element) return;
    const now = Date.now();
    if (now - this._lastTime < this._throttleMs) return;
    addPoint(this._element, point.x - this._element.x, point.y - this._element.y);
    this._lastPoint = point;
    this._lastTime = now;
    this.board.markDirty();
  }
  onPointerUp(point, e) {
    if (!this._element) return;
    addPoint(this._element, point.x - this._element.x, point.y - this._element.y);
    finalizeFreehand(this._element);
    if (this._element.points.length >= 2) {
      this.board.addElement(this._element);
    }
    this.board.clearDrawingElement();
    this._element = null;
    this._lastPoint = null;
  }
};

// src/tools/eraserTool.js
var EraserTool = class {
  constructor(board) {
    this.board = board;
    this._erasing = false;
    this._lastPoint = null;
    this.eraserRadius = DEFAULTS.eraserRadius;
  }
  onPointerDown(point, e) {
    this._erasing = true;
    this._lastPoint = point;
    this.eraserRadius = this.board.currentEraserRadius || DEFAULTS.eraserRadius;
    this._eraseAt(point);
  }
  onPointerMove(point, e) {
    if (!this._erasing || !this._lastPoint) return;
    this._eraseAlongLine(this._lastPoint, point);
    this._lastPoint = point;
  }
  onPointerUp(point, e) {
    if (this._erasing) {
      this.board.history.push(this.board.elements);
      this.board.scheduleSave();
    }
    this._erasing = false;
    this._lastPoint = null;
  }
  _eraseAt(point) {
    const toRemove = [];
    for (const el of this.board.elements) {
      if (this._hitTestErase(point, el)) {
        toRemove.push(el.id);
      }
    }
    for (const id of toRemove) {
      this.board.removeElement(id);
    }
  }
  _eraseAlongLine(from, to) {
    const steps = Math.max(1, Math.floor(
      Math.hypot(to.x - from.x, to.y - from.y) / (this.eraserRadius / 2)
    ));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pt = {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t
      };
      this._eraseAt(pt);
    }
  }
  _hitTestErase(point, el) {
    const margin = this.eraserRadius;
    if (point.x < el.x - margin || point.x > el.x + el.width + margin || point.y < el.y - margin || point.y > el.y + el.height + margin) {
      return false;
    }
    if (el.type === "freehand" && el.points) {
      for (let i = 0; i < el.points.length - 1; i++) {
        const p0 = { x: el.x + el.points[i].x, y: el.y + el.points[i].y };
        const p1 = { x: el.x + el.points[i + 1].x, y: el.y + el.points[i + 1].y };
        if (this.board.hitTest.distToSegment(point, p0, p1) < this.eraserRadius) {
          return true;
        }
      }
      return false;
    }
    if (el.type === "line" && el.points && el.points.length >= 2) {
      const p0 = { x: el.x + el.points[0].x, y: el.y + el.points[0].y };
      const p1 = { x: el.x + el.points[1].x, y: el.y + el.points[1].y };
      return this.board.hitTest.distToSegment(point, p0, p1) < this.eraserRadius;
    }
    return true;
  }
};

// src/elements/shapes.js
function createRectangle(x, y, w, h, cornerRadius = 0) {
  const el = createBaseElement("rectangle", x, y, w, h);
  el.cornerRadius = cornerRadius;
  return el;
}
function createEllipse(x, y, w, h) {
  return createBaseElement("ellipse", x, y, w, h);
}
function createDiamond(x, y, w, h) {
  return createBaseElement("diamond", x, y, w, h);
}
function createLine(x, y, x2, y2) {
  const el = createBaseElement("line", Math.min(x, x2), Math.min(y, y2), Math.abs(x2 - x), Math.abs(y2 - y));
  el.points = [
    { x: x - el.x, y: y - el.y },
    { x: x2 - el.x, y: y2 - el.y }
  ];
  el.endMarker = "none";
  el.startMarker = "none";
  return el;
}
function createArrow(x, y, x2, y2) {
  const el = createLine(x, y, x2, y2);
  el.type = "line";
  el.endMarker = "arrow";
  return el;
}
function normalizeShape(el) {
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

// src/tools/shapeTool.js
var ShapeTool = class {
  constructor(board, shapeType) {
    this.board = board;
    this.shapeType = shapeType;
    this._element = null;
    this._startPoint = null;
  }
  onPointerDown(point, e) {
    this._startPoint = point;
    this._element = this._createShape(point.x, point.y, 0, 0);
    if (this.shapeType === "line" || this.shapeType === "arrow") {
      this._element.points = [
        { x: 0, y: 0 },
        { x: 0, y: 0 }
      ];
    }
    this.board.setDrawingElement(this._element);
  }
  onPointerMove(point, e) {
    if (!this._element || !this._startPoint) return;
    const sx = this._startPoint.x;
    const sy = this._startPoint.y;
    let w = point.x - sx;
    let h = point.y - sy;
    if (e.shiftKey) {
      const size = Math.max(Math.abs(w), Math.abs(h));
      w = size * Math.sign(w || 1);
      h = size * Math.sign(h || 1);
    }
    if (this.shapeType === "line" || this.shapeType === "arrow") {
      this._element.points[1] = { x: w, y: h };
      this._element.x = Math.min(sx, point.x);
      this._element.y = Math.min(sy, point.y);
      this._element.width = Math.abs(w);
      this._element.height = Math.abs(h);
    } else {
      this._element.x = w >= 0 ? sx : sx + w;
      this._element.y = h >= 0 ? sy : sy + h;
      this._element.width = Math.abs(w);
      this._element.height = Math.abs(h);
    }
    this.board.markDirty();
  }
  onPointerUp(point, e) {
    if (!this._element) return;
    if (this._element.width > 2 || this._element.height > 2) {
      if (this.shapeType === "line" || this.shapeType === "arrow") {
        const sx = this._startPoint.x;
        const sy = this._startPoint.y;
        const minX = Math.min(sx, point.x);
        const minY = Math.min(sy, point.y);
        this._element.points[0] = { x: sx - minX, y: sy - minY };
        this._element.points[1] = { x: point.x - minX, y: point.y - minY };
        this._element.x = minX;
        this._element.y = minY;
      }
      normalizeShape(this._element);
      this.board.addElement(this._element);
    }
    this.board.clearDrawingElement();
    this._element = null;
    this._startPoint = null;
  }
  _createShape(x, y, w, h) {
    switch (this.shapeType) {
      case "rectangle":
        return createRectangle(x, y, w, h);
      case "ellipse":
        return createEllipse(x, y, w, h);
      case "diamond":
        return createDiamond(x, y, w, h);
      case "line":
        return createLine(x, y, x, y);
      case "arrow":
        return createArrow(x, y, x, y);
      default:
        return createRectangle(x, y, w, h);
    }
  }
};

// src/elements/text.js
function createTextElement(x, y, content = "") {
  const el = createBaseElement("text", x, y, 200, 40);
  el.content = content;
  el.fontSize = DEFAULTS.fontSize;
  el.fontFamily = DEFAULTS.fontFamily;
  el.textAlign = "left";
  el.backgroundColor = "#33333380";
  return el;
}
function measureText(content, fontSize, fontFamily) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = `${fontSize}px ${fontFamily}`;
  const lines = content.split("\n");
  let maxWidth = 0;
  for (const line of lines) {
    const m = ctx.measureText(line || " ");
    maxWidth = Math.max(maxWidth, m.width);
  }
  return {
    width: maxWidth + 16,
    height: lines.length * fontSize * 1.4 + 16
  };
}
function resizeTextElement(el) {
  if (!el.content) {
    el.width = 200;
    el.height = el.fontSize * 1.4 + 16;
    return;
  }
  const size = measureText(el.content, el.fontSize, el.fontFamily);
  el.width = Math.max(100, size.width);
  el.height = Math.max(el.fontSize * 1.4 + 16, size.height);
}

// src/tools/textTool.js
var TextTool = class {
  constructor(board) {
    this.board = board;
    this._editCallback = null;
  }
  onPointerDown(point, e) {
  }
  onPointerMove(point, e) {
  }
  onPointerUp(point, e) {
  }
  createAt(point) {
    const el = createTextElement(point.x, point.y, "");
    this.board.addElement(el);
    this._startEditing(el);
  }
  editElement(el) {
    this._startEditing(el);
  }
  _startEditing(el) {
    this._editCallback = el;
    if (this.board._onTextEdit) {
      this.board._onTextEdit(el);
    }
  }
  finishEditing(el, content) {
    el.content = content;
    resizeTextElement(el);
    this.board.history.push(this.board.elements);
    this.board.scheduleSave();
    this.board.markDirty();
    this._editCallback = null;
  }
  setOnTextEdit(callback) {
    this.board._onTextEdit = callback;
  }
};

// src/elements/image.js
function createImageElement(x, y, dataUrl, naturalWidth, naturalHeight) {
  const el = createBaseElement("image", x, y, naturalWidth, naturalHeight);
  el.dataUrl = dataUrl;
  el.naturalWidth = naturalWidth;
  el.naturalHeight = naturalHeight;
  el._img = null;
  return el;
}
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve({
        dataUrl: reader.result,
        width: img.naturalWidth,
        height: img.naturalHeight
      });
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function constrainImageSize(width, height, maxSize = 800) {
  if (width <= maxSize && height <= maxSize) return { width, height };
  const ratio = Math.min(maxSize / width, maxSize / height);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio)
  };
}

// src/tools/imageTool.js
var ImageTool = class {
  constructor(board) {
    this.board = board;
  }
  onPointerDown(point, e) {
  }
  onPointerMove(point, e) {
  }
  onPointerUp(point, e) {
  }
  openFile(atPoint) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) {
        await this.insertFromFile(file, atPoint);
      }
    };
    input.click();
  }
  async insertFromFile(file, atPoint) {
    try {
      const { dataUrl, width, height } = await loadImage(file);
      const size = constrainImageSize(width, height, 800);
      const point = atPoint || { x: 100, y: 100 };
      const el = createImageElement(point.x, point.y, dataUrl, size.width, size.height);
      el.width = size.width;
      el.height = size.height;
      this.board.addElement(el);
    } catch (e) {
    }
  }
};

// src/utils/clipboard.js
var clipboardData = null;
function copyElements(elements) {
  clipboardData = elements.map((el) => ({
    ...JSON.parse(JSON.stringify(el)),
    id: crypto.randomUUID()
  }));
}
function getClipboard() {
  return clipboardData ? clipboardData.map((el) => ({ ...el })) : null;
}

// src/core/board.js
var Board = class {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.pluginCtx = ctx;
    this.viewport = new Viewport();
    this.history = new History();
    this.renderer = new Renderer(canvas, this.viewport);
    this.hitTest = new HitTest();
    this.elements = [];
    this.selectedIds = /* @__PURE__ */ new Set();
    this.activeTool = "pen";
    this.currentTool = null;
    this.currentStrokeWidth = DEFAULTS.strokeWidth;
    this.currentStrokeColor = DEFAULTS.strokeColor;
    this.currentFillColor = DEFAULTS.fillColor;
    this.currentEraserRadius = DEFAULTS.eraserRadius;
    this.isPanning = false;
    this.isSpaceDown = false;
    this.lastPanPoint = null;
    this._activePointers = /* @__PURE__ */ new Map();
    this._pinching = false;
    this._pinchStartDist = 0;
    this._pinchStartZoom = 1;
    this._pinchCenter = { x: 0, y: 0 };
    this._pinchPointerIds = [];
    this._lastPinchCenter = null;
    this._velocity = { x: 0, y: 0 };
    this._lastPanTime = 0;
    this._panSamples = [];
    this._inertiaFrame = null;
    this._pinchVelocity = 0;
    this._lastPinchDist = 0;
    this._lastPinchTime = 0;
    this._animFrame = null;
    this._dirty = true;
    this._saveTimer = null;
    this._drawingElement = null;
    this._disposed = false;
    this._onToolChange = null;
    this._cssWidth = 0;
    this._cssHeight = 0;
    this.tools = {
      select: new SelectTool(this),
      pen: new PenTool(this),
      marker: new PenTool(this, "marker"),
      highlighter: new PenTool(this, "highlighter"),
      eraser: new EraserTool(this),
      rectangle: new ShapeTool(this, "rectangle"),
      ellipse: new ShapeTool(this, "ellipse"),
      diamond: new ShapeTool(this, "diamond"),
      line: new ShapeTool(this, "line"),
      arrow: new ShapeTool(this, "arrow"),
      text: new TextTool(this),
      image: new ImageTool(this)
    };
    this._setupEvents();
    this._startRenderLoop();
  }
  _setupEvents() {
    const c = this.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this._onPointerDown.bind(this));
    c.addEventListener("pointermove", this._onPointerMove.bind(this));
    c.addEventListener("pointerup", this._onPointerUp.bind(this));
    c.addEventListener("pointercancel", this._onPointerUp.bind(this));
    c.addEventListener("wheel", this._onWheel.bind(this), { passive: false });
    c.addEventListener("dblclick", this._onDblClick.bind(this));
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    document.addEventListener("keydown", this._onKeyDown);
    document.addEventListener("keyup", this._onKeyUp);
    this._onPaste = this._onPaste.bind(this);
    document.addEventListener("paste", this._onPaste);
    this._onResize = this._onResize.bind(this);
    this._resizeObserver = new ResizeObserver(this._onResize);
    this._resizeObserver.observe(c.parentElement);
    this._onResize();
  }
  _onResize() {
    const parent = this.canvas.parentElement;
    if (!parent || parent.clientWidth === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = parent.clientWidth;
    const cssH = parent.clientHeight;
    this.canvas.width = cssW * dpr;
    this.canvas.height = cssH * dpr;
    this.canvas.style.width = cssW + "px";
    this.canvas.style.height = cssH + "px";
    this._cssWidth = cssW;
    this._cssHeight = cssH;
    this._dirty = true;
  }
  _getCanvasPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  _onPointerDown(e) {
    const screenPt = this._getCanvasPoint(e);
    if (!this._pinching && this._activePointers.size > 0 && !this._activePointers.has(e.pointerId)) {
      this._activePointers.clear();
    }
    this._activePointers.set(e.pointerId, screenPt);
    if (this._activePointers.size === 2) {
      this._startPinch();
      return;
    }
    if (this._pinching) return;
    if (e.button === 1 || e.button === 0 && this.isSpaceDown) {
      this._stopInertia();
      this.isPanning = true;
      this.lastPanPoint = screenPt;
      this._panSamples = [];
      this._lastPanTime = performance.now();
      this.canvas.style.cursor = "grabbing";
      return;
    }
    if (e.button !== 0) return;
    this._stopInertia();
    const worldPt = this.viewport.screenToWorld(screenPt.x, screenPt.y);
    const tool = this.tools[this.activeTool];
    if (tool && tool.onPointerDown) {
      tool.onPointerDown(worldPt, e);
    }
    this._dirty = true;
  }
  _onPointerMove(e) {
    const screenPt = this._getCanvasPoint(e);
    if (this._activePointers.has(e.pointerId)) {
      this._activePointers.set(e.pointerId, screenPt);
    }
    if (this._pinching && this._activePointers.size >= 2) {
      this._updatePinch();
      return;
    }
    if (this.isPanning && this.lastPanPoint) {
      const dx = screenPt.x - this.lastPanPoint.x;
      const dy = screenPt.y - this.lastPanPoint.y;
      this.viewport.pan(dx, dy);
      this.lastPanPoint = screenPt;
      const now = performance.now();
      this._panSamples.push({ dx, dy, dt: now - (this._lastPanTime || now) });
      if (this._panSamples.length > 5) this._panSamples.shift();
      this._lastPanTime = now;
      this._dirty = true;
      return;
    }
    const worldPt = this.viewport.screenToWorld(screenPt.x, screenPt.y);
    const tool = this.tools[this.activeTool];
    if (tool && tool.onPointerMove) {
      tool.onPointerMove(worldPt, e);
    }
  }
  _onPointerUp(e) {
    this._activePointers.delete(e.pointerId);
    if (this._pinching) {
      if (this._activePointers.size < 2) {
        this._pinching = false;
        this._pinchPointerIds = [];
        this._lastPinchCenter = null;
        this._lastPinchTime = 0;
        const tool2 = this.tools[this.activeTool];
        if (tool2 && tool2.onPointerUp) {
          const screenPt2 = this._getCanvasPoint(e);
          const worldPt2 = this.viewport.screenToWorld(screenPt2.x, screenPt2.y);
          tool2.onPointerUp(worldPt2, e);
        }
        const vel = this._computeVelocity();
        if (Math.abs(vel.x) > 1 || Math.abs(vel.y) > 1) {
          this._startInertia(vel.x, vel.y);
        }
        if (Math.abs(this._pinchVelocity) > 1e-3) {
          this._startZoomInertia(this._pinchVelocity);
        }
      }
      this._panSamples = [];
      this._dirty = true;
      return;
    }
    if (this.isPanning) {
      this.isPanning = false;
      this.lastPanPoint = null;
      this.canvas.style.cursor = "";
      const vel = this._computeVelocity();
      if (Math.abs(vel.x) > 1 || Math.abs(vel.y) > 1) {
        this._startInertia(vel.x, vel.y);
      }
      this._panSamples = [];
      return;
    }
    const screenPt = this._getCanvasPoint(e);
    const worldPt = this.viewport.screenToWorld(screenPt.x, screenPt.y);
    const tool = this.tools[this.activeTool];
    if (tool && tool.onPointerUp) {
      tool.onPointerUp(worldPt, e);
    }
    this._dirty = true;
  }
  _startPinch() {
    const pts = Array.from(this._activePointers.values());
    const [a, b] = pts;
    this._pinching = true;
    this._pinchStartDist = Math.hypot(b.x - a.x, b.y - a.y);
    this._pinchStartZoom = this.viewport.zoom;
    this._pinchCenter = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this._pinchPointerIds = Array.from(this._activePointers.keys());
    this._lastPinchDist = this._pinchStartDist;
    this._lastPinchTime = 0;
    this._pinchVelocity = 0;
    this._panSamples = [];
    this._stopInertia();
    this.clearDrawingElement();
  }
  _updatePinch() {
    const ids = this._pinchPointerIds;
    const a = this._activePointers.get(ids[0]);
    const b = this._activePointers.get(ids[1]);
    if (!a || !b) return;
    const now = performance.now();
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (this._pinchStartDist > 0) {
      const scale = dist / this._pinchStartDist;
      const logScale = Math.log2(scale);
      const rawZoom = this._pinchStartZoom * Math.pow(2, logScale);
      const MIN_ZOOM = LIMITS.zoom.min;
      const MAX_ZOOM = LIMITS.zoom.max;
      let newZoom;
      if (rawZoom < MIN_ZOOM) {
        newZoom = MIN_ZOOM + (rawZoom - MIN_ZOOM) * 0.3;
      } else if (rawZoom > MAX_ZOOM) {
        newZoom = MAX_ZOOM + (rawZoom - MAX_ZOOM) * 0.3;
      } else {
        newZoom = rawZoom;
      }
      const oldZoom = this.viewport.zoom;
      const ratio = newZoom / oldZoom;
      this.viewport.zoom = newZoom;
      this.viewport.x = center.x - (center.x - this.viewport.x) * ratio;
      this.viewport.y = center.y - (center.y - this.viewport.y) * ratio;
      if (this._lastPinchTime > 0) {
        const dt = now - this._lastPinchTime;
        if (dt > 0) {
          const distDelta = dist - this._lastPinchDist;
          this._pinchVelocity = distDelta / dt;
        }
      }
      this._lastPinchDist = dist;
      this._lastPinchTime = now;
    }
    if (this._lastPinchCenter) {
      const dx = center.x - this._lastPinchCenter.x;
      const dy = center.y - this._lastPinchCenter.y;
      this.viewport.pan(dx, dy);
      this._panSamples.push({ dx, dy, dt: now - (this._lastPanTime || now) });
      if (this._panSamples.length > 5) this._panSamples.shift();
      this._lastPanTime = now;
    }
    this._lastPinchCenter = center;
    this._dirty = true;
  }
  _startInertia(vx, vy) {
    if (this._inertiaFrame) cancelAnimationFrame(this._inertiaFrame);
    let cvx = vx, cvy = vy;
    const friction = 0.92;
    const threshold = 0.5;
    let lastTime = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(now - lastTime, 32) / 16;
      lastTime = now;
      cvx *= Math.pow(friction, dt);
      cvy *= Math.pow(friction, dt);
      if (Math.abs(cvx) < threshold && Math.abs(cvy) < threshold) {
        this._inertiaFrame = null;
        return;
      }
      this.viewport.pan(cvx * dt, cvy * dt);
      this._dirty = true;
      this._inertiaFrame = requestAnimationFrame(tick);
    };
    this._inertiaFrame = requestAnimationFrame(tick);
  }
  _startZoomInertia(velocity) {
    if (this._inertiaFrame) cancelAnimationFrame(this._inertiaFrame);
    let v = velocity;
    const friction = 0.88;
    const threshold = 5e-4;
    let lastTime = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(now - lastTime, 32) / 16;
      lastTime = now;
      v *= Math.pow(friction, dt);
      if (Math.abs(v) < threshold) {
        this.viewport.zoom = Math.max(LIMITS.zoom.min, Math.min(LIMITS.zoom.max, this.viewport.zoom));
        this._inertiaFrame = null;
        this._dirty = true;
        return;
      }
      const oldZoom = this.viewport.zoom;
      const newZoom = Math.max(LIMITS.zoom.min * 0.8, Math.min(LIMITS.zoom.max * 1.2, oldZoom * Math.pow(2, v * dt)));
      const ratio = newZoom / oldZoom;
      this.viewport.zoom = newZoom;
      const cx = this._cssWidth / 2;
      const cy = this._cssHeight / 2;
      this.viewport.x = cx - (cx - this.viewport.x) * ratio;
      this.viewport.y = cy - (cy - this.viewport.y) * ratio;
      this._dirty = true;
      this._inertiaFrame = requestAnimationFrame(tick);
    };
    this._inertiaFrame = requestAnimationFrame(tick);
  }
  _stopInertia() {
    if (this._inertiaFrame) {
      cancelAnimationFrame(this._inertiaFrame);
      this._inertiaFrame = null;
    }
  }
  _computeVelocity() {
    const samples = this._panSamples;
    if (samples.length === 0) return { x: 0, y: 0 };
    let totalWeight = 0, vx = 0, vy = 0;
    for (let i = 0; i < samples.length; i++) {
      const w = i + 1;
      const dt = samples[i].dt || 16;
      vx += samples[i].dx / dt * w;
      vy += samples[i].dy / dt * w;
      totalWeight += w;
    }
    return { x: vx / totalWeight * 16, y: vy / totalWeight * 16 };
  }
  _onWheel(e) {
    e.preventDefault();
    this._stopInertia();
    const screenPt = this._getCanvasPoint(e);
    if (e.ctrlKey || e.metaKey) {
      this.viewport.zoomAt(screenPt.x, screenPt.y, e.deltaY);
    } else {
      this.viewport.pan(-e.deltaX, -e.deltaY);
    }
    this._dirty = true;
  }
  _onDblClick(e) {
    const screenPt = this._getCanvasPoint(e);
    const worldPt = this.viewport.screenToWorld(screenPt.x, screenPt.y);
    if (this.activeTool === "text") {
      this.tools.text.createAt(worldPt);
    } else {
      const hit = this.hitTest.pointTest(worldPt, this.elements);
      if (hit && hit.type === "text") {
        this.tools.text.editElement(hit);
      }
    }
  }
  _onKeyDown(e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.code === "Space" && !this.isSpaceDown) {
      this.isSpaceDown = true;
      this.canvas.style.cursor = "grab";
      e.preventDefault();
      return;
    }
    if (ctrl && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      this.undo();
      return;
    }
    if (ctrl && (e.key === "Z" || e.key === "z" && e.shiftKey)) {
      e.preventDefault();
      this.redo();
      return;
    }
    if (ctrl && e.key === "a") {
      e.preventDefault();
      this.selectAll();
      return;
    }
    if (ctrl && e.key === "c") {
      e.preventDefault();
      this.copySelected();
      return;
    }
    if (ctrl && e.key === "v") return;
    if (e.key === "Delete" || e.key === "Backspace") {
      if (e.target === document.body || e.target === this.canvas) {
        e.preventDefault();
        this.deleteSelected();
      }
      return;
    }
    if (ctrl && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      this.zoomIn();
      return;
    }
    if (ctrl && e.key === "-") {
      e.preventDefault();
      this.zoomOut();
      return;
    }
    if (ctrl && e.key === "0") {
      e.preventDefault();
      this.viewport.reset();
      this._dirty = true;
      return;
    }
    if (!ctrl && !e.altKey && !e.metaKey) {
      const toolMap = {
        v: "select",
        p: "pen",
        e: "eraser",
        r: "rectangle",
        o: "ellipse",
        d: "diamond",
        l: "line",
        a: "arrow",
        t: "text"
      };
      const tool = toolMap[e.key];
      if (tool) {
        this.setTool(tool);
        return;
      }
      const numToolMap = {
        "1": "select",
        "2": "rectangle",
        "3": "diamond",
        "4": "ellipse",
        "5": "arrow",
        "6": "line",
        "7": "pen",
        "8": "text",
        "9": "eraser",
        "0": "image"
      };
      const numTool = numToolMap[e.key];
      if (numTool) {
        this.setTool(numTool);
        if (numTool === "image") this.tools.image.openFile();
        return;
      }
      if (e.key === "[" || e.key === "]") {
        const delta = e.key === "]" ? 1 : -1;
        if (this.activeTool === "eraser") {
          this.currentEraserRadius = Math.max(4, Math.min(60, this.currentEraserRadius + delta * 4));
        } else {
          this.currentStrokeWidth = Math.max(1, Math.min(20, this.currentStrokeWidth + delta));
        }
        this._dirty = true;
        if (this._onToolChange) this._onToolChange(this.activeTool);
        return;
      }
    }
  }
  _onKeyUp(e) {
    if (e.code === "Space") {
      this.isSpaceDown = false;
      if (!this.isPanning) this.canvas.style.cursor = "";
    }
  }
  _onPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) this.tools.image.insertFromFile(file);
        return;
      }
    }
  }
  _startRenderLoop() {
    const loop = () => {
      if (this._dirty && !this._disposed) {
        this._render();
        this._dirty = false;
      }
      if (!this._disposed) this._animFrame = requestAnimationFrame(loop);
    };
    loop();
  }
  _render() {
    const { renderer, viewport, elements, selectedIds } = this;
    const ctx = renderer.ctx;
    const dpr = window.devicePixelRatio || 1;
    const w = this._cssWidth || this.canvas.width / dpr;
    const h = this._cssHeight || this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderer.drawBackground(w, h);
    ctx.save();
    viewport.applyTransform(ctx);
    renderer.drawGrid(w, h);
    for (const el of elements) {
      renderer.renderElement(el);
    }
    if (this._drawingElement) {
      renderer.renderElement(this._drawingElement);
    }
    for (const el of elements) {
      if (selectedIds.has(el.id)) {
        renderer.drawSelectionHandles(el, viewport.zoom);
      }
    }
    ctx.restore();
  }
  markDirty() {
    this._dirty = true;
  }
  scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), 500);
  }
  async save() {
    try {
      await this.pluginCtx.storage.set("board", {
        version: 1,
        elements: this.elements,
        viewport: this.viewport.serialize(),
        background: "#ffffff"
      });
    } catch (e) {
    }
  }
  async load() {
    try {
      const data = await this.pluginCtx.storage.get("board");
      if (data) {
        this.elements = data.elements || [];
        this.viewport.deserialize(data.viewport);
        this.history.push(this.elements);
        this._dirty = true;
      }
    } catch (e) {
    }
  }
  setTool(name) {
    this.clearDrawingElement();
    this.activeTool = name;
    this.currentTool = this.tools[name];
    this._dirty = true;
    if (this._onToolChange) this._onToolChange(name);
  }
  setOnToolChange(cb) {
    this._onToolChange = cb;
  }
  getTool() {
    return this.activeTool;
  }
  addElement(el) {
    this.elements.push(el);
    this.history.push(this.elements);
    this.scheduleSave();
    this._dirty = true;
  }
  removeElement(id) {
    this.elements = this.elements.filter((e) => e.id !== id);
    this.selectedIds.delete(id);
    this.history.push(this.elements);
    this.scheduleSave();
    this._dirty = true;
  }
  updateElement(id, updates) {
    const el = this.elements.find((e) => e.id === id);
    if (el) {
      Object.assign(el, updates);
      this.history.push(this.elements);
      this.scheduleSave();
      this._dirty = true;
    }
  }
  setDrawingElement(el) {
    this._drawingElement = el;
    this._dirty = true;
  }
  clearDrawingElement() {
    this._drawingElement = null;
    this._dirty = true;
  }
  selectElement(id) {
    this.selectedIds.clear();
    this.selectedIds.add(id);
    this._dirty = true;
  }
  addToSelection(id) {
    this.selectedIds.add(id);
    this._dirty = true;
  }
  toggleSelection(id) {
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
    this._dirty = true;
  }
  clearSelection() {
    this.selectedIds.clear();
    this._dirty = true;
  }
  selectAll() {
    this.selectedIds.clear();
    for (const el of this.elements) this.selectedIds.add(el.id);
    this._dirty = true;
  }
  getSelectedElements() {
    return this.elements.filter((el) => this.selectedIds.has(el.id));
  }
  deleteSelected() {
    if (this.selectedIds.size === 0) return;
    this.elements = this.elements.filter((el) => !this.selectedIds.has(el.id));
    this.selectedIds.clear();
    this.history.push(this.elements);
    this.scheduleSave();
    this._dirty = true;
  }
  copySelected() {
    const selected = this.getSelectedElements();
    if (selected.length === 0) return;
    copyElements(selected);
  }
  undo() {
    const snapshot = this.history.undo();
    if (snapshot) {
      this.elements = snapshot;
      this.selectedIds.clear();
      this.scheduleSave();
      this._dirty = true;
    }
  }
  redo() {
    const snapshot = this.history.redo();
    if (snapshot) {
      this.elements = snapshot;
      this.selectedIds.clear();
      this.scheduleSave();
      this._dirty = true;
    }
  }
  zoomIn() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    this.viewport.zoomAt(c.width / dpr / 2, c.height / dpr / 2, -100);
    this._dirty = true;
  }
  zoomOut() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    this.viewport.zoomAt(c.width / dpr / 2, c.height / dpr / 2, 100);
    this._dirty = true;
  }
  clearAll() {
    this.elements = [];
    this.selectedIds.clear();
    this.history.clear();
    this.history.push([]);
    this.scheduleSave();
    this._dirty = true;
  }
  getWorldBounds(elements) {
    if (!elements || elements.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of elements) {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + (el.width || 0));
      maxY = Math.max(maxY, el.y + (el.height || 0));
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  dispose() {
    this._disposed = true;
    this._stopInertia();
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
    if (this._saveTimer) clearTimeout(this._saveTimer);
    document.removeEventListener("keydown", this._onKeyDown);
    document.removeEventListener("keyup", this._onKeyUp);
    document.removeEventListener("paste", this._onPaste);
    if (this._resizeObserver) this._resizeObserver.disconnect();
  }
};

// src/ui/toolbar.js
function icon(paths) {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}
var ICONS = {
  select: icon('<path d="M4 4l7 17 2.5-6.5L20 12z"/><path d="M14.5 14.5L18 18"/>'),
  pen: icon('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>'),
  marker: icon('<path d="M18.37 2.63a2.12 2.12 0 0 1 3 3L14 13l-4 1 1-4Z"/>'),
  highlighter: icon('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'),
  eraser: icon('<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>'),
  rectangle: icon('<rect x="3" y="3" width="18" height="18" rx="2"/>'),
  ellipse: icon('<ellipse cx="12" cy="12" rx="10" ry="10"/>'),
  diamond: icon('<path d="M12 2 L22 12 L12 22 L2 12 Z"/>'),
  line: icon('<path d="M5 19L19 5"/>'),
  arrow: icon('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'),
  text: icon('<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>'),
  image: icon('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
  undo: icon('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>'),
  redo: icon('<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>'),
  download: icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  trash: icon('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
  grid: icon('<path d="M3 3h18v18H3z"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>')
};
function renderToolbar(h, board, state) {
  const tool = board.getTool();
  const children = [];
  const toolGroups = [
    [{ id: "select", icon: ICONS.select, label: "\u9009\u62E9", key: "V" }],
    [
      { id: "pen", icon: ICONS.pen, label: "\u753B\u7B14", key: "P" },
      { id: "marker", icon: ICONS.marker, label: "\u9A6C\u514B\u7B14" },
      { id: "highlighter", icon: ICONS.highlighter, label: "\u8367\u5149\u7B14" },
      { id: "eraser", icon: ICONS.eraser, label: "\u6A61\u76AE\u64E6", key: "E" }
    ],
    [
      { id: "rectangle", icon: ICONS.rectangle, label: "\u77E9\u5F62", key: "R" },
      { id: "ellipse", icon: ICONS.ellipse, label: "\u692D\u5706", key: "O" },
      { id: "diamond", icon: ICONS.diamond, label: "\u83F1\u5F62", key: "D" },
      { id: "line", icon: ICONS.line, label: "\u7EBF\u6BB5", key: "L" },
      { id: "arrow", icon: ICONS.arrow, label: "\u7BAD\u5934", key: "A" }
    ],
    [
      { id: "text", icon: ICONS.text, label: "\u6587\u672C", key: "T" },
      { id: "image", icon: ICONS.image, label: "\u56FE\u7247" }
    ]
  ];
  for (const group of toolGroups) {
    const buttons = group.map(
      (t) => h("button", {
        class: "wb-tool-btn" + (tool === t.id ? " active" : ""),
        title: `${t.label}${t.key ? ` (${t.key})` : ""}`,
        onClick: () => {
          board.setTool(t.id);
          if (t.id === "image") board.tools.image.openFile();
          state.activeTool = t.id;
        },
        innerHTML: t.icon
      })
    );
    children.push(h("div", { class: "wb-tool-group" }, buttons));
    children.push(h("div", { class: "wb-divider" }));
  }
  children.push(h("div", { class: "wb-tool-group" }, [
    h("button", {
      class: "wb-tool-btn",
      title: "\u64A4\u9500 (Ctrl+Z)",
      disabled: !board.history.canUndo(),
      onClick: () => {
        board.undo();
      },
      innerHTML: ICONS.undo
    }),
    h("button", {
      class: "wb-tool-btn",
      title: "\u91CD\u505A (Ctrl+Shift+Z)",
      disabled: !board.history.canRedo(),
      onClick: () => {
        board.redo();
      },
      innerHTML: ICONS.redo
    })
  ]));
  children.push(h("div", { class: "wb-divider" }));
  children.push(h("div", { class: "wb-tool-group" }, [
    h("button", {
      class: "wb-tool-btn wb-color-btn",
      title: "\u63CF\u8FB9\u989C\u8272",
      onClick: () => {
        state.showColorPicker = !state.showColorPicker;
      }
    }, [
      h("span", { class: "wb-color-preview", style: { background: state.strokeColor } })
    ]),
    h("button", {
      class: "wb-tool-btn wb-color-btn",
      title: "\u586B\u5145\u989C\u8272",
      onClick: () => {
        state.showFillPicker = !state.showFillPicker;
      }
    }, [
      h("span", {
        class: "wb-color-preview wb-fill-preview",
        style: { background: state.fillColor || "transparent", borderColor: state.fillColor ? state.fillColor : "#ccc" }
      })
    ])
  ]));
  children.push(h("div", { class: "wb-tool-group" }, [
    h("button", {
      class: "wb-tool-btn",
      title: "\u7EBF\u5BBD",
      onClick: () => {
        state.showWidthPicker = !state.showWidthPicker;
      }
    }, [
      h("span", { style: { display: "block", width: "16px", height: Math.min(state.strokeWidth, 6) + "px", background: "#333", borderRadius: "2px" } })
    ])
  ]));
  children.push(h("div", { class: "wb-divider" }));
  children.push(h("div", { class: "wb-tool-group" }, [
    h("button", {
      class: "wb-tool-btn" + (state.showGrid ? " active" : ""),
      title: state.showGrid ? "\u9690\u85CF\u7F51\u683C" : "\u663E\u793A\u7F51\u683C",
      onClick: () => {
        state.showGrid = !state.showGrid;
        board.renderer.showGrid = state.showGrid;
        board.markDirty();
      },
      innerHTML: ICONS.grid
    })
  ]));
  children.push(h("div", { class: "wb-divider" }));
  children.push(h("div", { class: "wb-tool-group" }, [
    h("button", {
      class: "wb-tool-btn",
      title: "\u5BFC\u51FA",
      onClick: () => {
        state.showExport = true;
      },
      innerHTML: ICONS.download
    }),
    h("button", {
      class: "wb-tool-btn",
      title: "\u6E05\u7A7A\u753B\u5E03",
      onClick: async () => {
        if (await board.pluginCtx.ui.confirm("\u786E\u5B9A\u6E05\u7A7A\u753B\u5E03\uFF1F")) board.clearAll();
      },
      innerHTML: ICONS.trash
    })
  ]));
  return children;
}

// src/ui/minimap.js
function drawMinimap(minimapCanvas, board, mainCanvasWidth, mainCanvasHeight) {
  if (!minimapCanvas) return;
  const ctx = minimapCanvas.getContext("2d");
  const W = minimapCanvas.width;
  const H = minimapCanvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#fafafa";
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
    ctx.fillStyle = el.strokeColor || "#333333";
    ctx.globalAlpha = 0.5;
    if (el.type === "freehand") {
      if (el.points && el.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(el.x + el.points[0].x, el.y + el.points[0].y);
        for (let i = 1; i < el.points.length; i++) {
          ctx.lineTo(el.x + el.points[i].x, el.y + el.points[i].y);
        }
        ctx.strokeStyle = el.strokeColor || "#333333";
        ctx.lineWidth = 2 / scale;
        ctx.stroke();
      }
    } else {
      ctx.fillRect(el.x, el.y, el.width || 0, el.height || 0);
    }
  }
  ctx.restore();
  const vp = board.viewport;
  const vpX = -vp.x / vp.zoom * scale + offsetX;
  const vpY = -vp.y / vp.zoom * scale + offsetY;
  const vpW = mainCanvasWidth / vp.zoom * scale;
  const vpH = mainCanvasHeight / vp.zoom * scale;
  ctx.strokeStyle = "#1a73e8";
  ctx.lineWidth = 1;
  ctx.strokeRect(vpX, vpY, vpW, vpH);
}

// src/main.js
function activate(ctx) {
  const { h, ref, reactive, onMounted, onUnmounted } = ctx;
  ctx.commands.register("whiteboard.open", () => {
  });
  ctx.commands.register("whiteboard.new", () => {
  });
  ctx.commands.register("whiteboard.clear", () => {
  });
  ctx.commands.register("whiteboard.export-png", () => {
  });
  ctx.commands.register("whiteboard.export-json", () => {
  });
  const component = {
    setup() {
      const rootRef = ref(null);
      const state = reactive({
        activeTool: "pen",
        strokeColor: DEFAULTS.strokeColor,
        fillColor: DEFAULTS.fillColor,
        strokeWidth: DEFAULTS.strokeWidth,
        zoom: 1,
        showGrid: true,
        showColorPicker: false,
        showFillPicker: false,
        showWidthPicker: false,
        showExport: false,
        editingText: null
      });
      let board = null;
      let toolbarEl = null;
      let canvasContainer = null;
      let statusbarEl = null;
      let popupsEl = null;
      let overlayEl = null;
      let minimapCanvas = null;
      let activeTextEdit = null;
      function cleanupTextEdit() {
        if (activeTextEdit) {
          activeTextEdit.remove();
          activeTextEdit = null;
        }
        state.editingText = null;
      }
      function updateToolbar() {
        if (!toolbarEl || !board) return;
        const vnode = h("div", { class: "wb-toolbar-inner" }, renderToolbar(h, board, state));
        toolbarEl.innerHTML = "";
        const items = renderToolbar(h, board, state);
        for (const item of items) {
        }
      }
      onMounted(() => {
        const root = rootRef.value;
        if (!root) return;
        root.innerHTML = "";
        toolbarEl = document.createElement("div");
        toolbarEl.className = "wb-toolbar";
        root.appendChild(toolbarEl);
        canvasContainer = document.createElement("div");
        canvasContainer.className = "wb-canvas-container";
        root.appendChild(canvasContainer);
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;touch-action:none;";
        canvasContainer.appendChild(canvas);
        minimapCanvas = document.createElement("canvas");
        minimapCanvas.width = 160;
        minimapCanvas.height = 120;
        minimapCanvas.className = "wb-minimap-canvas";
        minimapCanvas.style.cssText = "position:absolute;bottom:10px;right:10px;border:1px solid #e0e0e0;border-radius:6px;background:#fafafa;z-index:5;pointer-events:none;display:none;";
        canvasContainer.appendChild(minimapCanvas);
        overlayEl = document.createElement("div");
        overlayEl.className = "wb-overlay-layer";
        canvasContainer.appendChild(overlayEl);
        popupsEl = document.createElement("div");
        popupsEl.className = "wb-popups";
        root.appendChild(popupsEl);
        statusbarEl = document.createElement("div");
        statusbarEl.className = "wb-statusbar";
        root.appendChild(statusbarEl);
        board = new Board(canvas, ctx);
        board.currentStrokeWidth = state.strokeWidth;
        board.currentStrokeColor = state.strokeColor;
        board.currentFillColor = state.fillColor;
        board.setTool("pen");
        board.tools.text.setOnTextEdit((el) => {
          cleanupTextEdit();
          state.editingText = el;
          const vp = board.viewport;
          const dpr = window.devicePixelRatio || 1;
          const sx = el.x * vp.zoom + vp.x;
          const sy = el.y * vp.zoom + vp.y;
          const sw = el.width * vp.zoom;
          const sh = el.height * vp.zoom;
          const textarea = document.createElement("textarea");
          textarea.value = el.content || "";
          textarea.className = "wb-text-edit-overlay";
          textarea.style.cssText = `left:${sx}px;top:${sy}px;width:${Math.max(100, sw)}px;height:${Math.max(30, sh)}px;font-size:${el.fontSize * vp.zoom}px;font-family:${el.fontFamily};text-align:${el.textAlign || "left"};`;
          overlayEl.appendChild(textarea);
          activeTextEdit = textarea;
          const origContent = el.content || "";
          function autoResize() {
            textarea.style.height = "auto";
            textarea.style.height = textarea.scrollHeight + "px";
          }
          textarea.addEventListener("input", () => {
            el.content = textarea.value;
            resizeTextElement(el);
            autoResize();
            board.markDirty();
          });
          textarea.addEventListener("blur", () => {
            if (textarea.value.trim()) {
              board.tools.text.finishEditing(el, textarea.value);
            } else {
              el.content = origContent;
              if (!origContent) board.removeElement(el.id);
              else {
                resizeTextElement(el);
                board.markDirty();
              }
            }
            cleanupTextEdit();
          });
          textarea.addEventListener("keydown", (ev) => {
            if (ev.key === "Escape") {
              el.content = origContent;
              if (!origContent) board.removeElement(el.id);
              else {
                resizeTextElement(el);
                board.markDirty();
              }
              cleanupTextEdit();
            }
          });
          requestAnimationFrame(() => {
            textarea.focus();
            autoResize();
          });
        });
        const origOnKeyDown = board._onKeyDown.bind(board);
        board._onKeyDown = (e) => {
          const ctrl = e.ctrlKey || e.metaKey;
          if (ctrl && e.key === "v" && !state.editingText) {
            const clipboard = getClipboard();
            if (clipboard && clipboard.length > 0) {
              e.preventDefault();
              for (const el of clipboard) {
                el.x += 20;
                el.y += 20;
                board.addElement(el);
              }
            }
          }
          origOnKeyDown(e);
        };
        board.copySelected = () => {
          const selected = board.getSelectedElements();
          if (selected.length > 0) {
            copyElements(selected);
            ctx.ui.notify("\u5DF2\u590D\u5236 " + selected.length + " \u4E2A\u5143\u7D20");
          }
        };
        board.load();
        board.setOnToolChange((name) => {
          state.activeTool = name;
          renderToolbarUI();
          updateStatusBar();
        });
        renderToolbarUI();
        updateStatusBar();
        const toolNames = {
          select: "\u9009\u62E9",
          pen: "\u753B\u7B14",
          marker: "\u9A6C\u514B\u7B14",
          highlighter: "\u8367\u5149\u7B14",
          eraser: "\u6A61\u76AE\u64E6",
          rectangle: "\u77E9\u5F62",
          ellipse: "\u692D\u5706",
          diamond: "\u83F1\u5F62",
          line: "\u7EBF\u6BB5",
          arrow: "\u7BAD\u5934",
          text: "\u6587\u672C",
          image: "\u56FE\u7247"
        };
        let lastZoom = -1;
        let lastTool = "";
        let lastElementCount = -1;
        const tick = () => {
          if (!board || board._disposed) {
            requestAnimationFrame(tick);
            return;
          }
          const z = board.viewport.zoom;
          if (Math.abs(z - lastZoom) > 1e-3) {
            lastZoom = z;
            state.zoom = z;
            updateStatusBar();
          }
          if (board.renderer.showGrid !== state.showGrid) {
            board.renderer.showGrid = state.showGrid;
          }
          minimapCanvas.style.display = board.elements.length > 0 ? "block" : "none";
          if (board.elements.length > 0) {
            drawMinimap(minimapCanvas, board, board._cssWidth, board._cssHeight);
          }
          if (board.elements.length !== lastElementCount) {
            lastElementCount = board.elements.length;
            updateStatusBar();
          }
          requestAnimationFrame(tick);
        };
        tick();
      });
      function renderToolbarUI() {
        if (!toolbarEl || !board) return;
        toolbarEl.innerHTML = "";
        const tool = state.activeTool;
        const toolGroups = [
          [{ id: "select", label: "\u9009\u62E9", key: "V/1", svg: '<path d="M4 4l7 17 2.5-6.5L20 12z"/><path d="M14.5 14.5L18 18"/>' }],
          [
            { id: "pen", label: "\u753B\u7B14", key: "P/7", svg: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>' },
            { id: "marker", label: "\u9A6C\u514B\u7B14", svg: '<path d="M18.37 2.63a2.12 2.12 0 0 1 3 3L14 13l-4 1 1-4Z"/>' },
            { id: "highlighter", label: "\u8367\u5149\u7B14", svg: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>' },
            { id: "eraser", label: "\u6A61\u76AE\u64E6", key: "E/9", svg: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>' }
          ],
          [
            { id: "rectangle", label: "\u77E9\u5F62", key: "R/2", svg: '<rect x="3" y="3" width="18" height="18" rx="2"/>' },
            { id: "ellipse", label: "\u692D\u5706", key: "O/4", svg: '<ellipse cx="12" cy="12" rx="10" ry="10"/>' },
            { id: "diamond", label: "\u83F1\u5F62", key: "D/3", svg: '<path d="M12 2 L22 12 L12 22 L2 12 Z"/>' },
            { id: "line", label: "\u7EBF\u6BB5", key: "L/6", svg: '<path d="M5 19L19 5"/>' },
            { id: "arrow", label: "\u7BAD\u5934", key: "A/5", svg: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>' }
          ],
          [
            { id: "text", label: "\u6587\u672C", key: "T/8", svg: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>' },
            { id: "image", label: "\u56FE\u7247", key: "0", svg: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>' }
          ]
        ];
        function makeSVG(paths) {
          return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
        }
        function makeBtn(innerHTML, title, onClick, active = false, disabled = false) {
          const btn = document.createElement("button");
          btn.className = "wb-tool-btn" + (active ? " active" : "");
          btn.title = title;
          btn.innerHTML = innerHTML;
          if (disabled) btn.disabled = true;
          btn.addEventListener("click", onClick);
          return btn;
        }
        for (const group of toolGroups) {
          const groupEl = document.createElement("div");
          groupEl.className = "wb-tool-group";
          for (const t of group) {
            const btn = makeBtn(
              makeSVG(t.svg),
              `${t.label}${t.key ? ` (${t.key})` : ""}`,
              () => {
                state.activeTool = t.id;
                board.setTool(t.id);
                if (t.id === "image") board.tools.image.openFile();
                renderToolbarUI();
              },
              tool === t.id
            );
            groupEl.appendChild(btn);
          }
          toolbarEl.appendChild(groupEl);
          const divider = document.createElement("div");
          divider.className = "wb-divider";
          toolbarEl.appendChild(divider);
        }
        const undoGroup = document.createElement("div");
        undoGroup.className = "wb-tool-group";
        undoGroup.appendChild(makeBtn(
          makeSVG('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>'),
          "\u64A4\u9500 (Ctrl+Z)",
          () => {
            board.undo();
            renderToolbarUI();
          },
          false,
          !board.history.canUndo()
        ));
        undoGroup.appendChild(makeBtn(
          makeSVG('<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>'),
          "\u91CD\u505A (Ctrl+Shift+Z)",
          () => {
            board.redo();
            renderToolbarUI();
          },
          false,
          !board.history.canRedo()
        ));
        toolbarEl.appendChild(undoGroup);
        const div2 = document.createElement("div");
        div2.className = "wb-divider";
        toolbarEl.appendChild(div2);
        const colorGroup = document.createElement("div");
        colorGroup.className = "wb-tool-group";
        const strokeBtn = makeBtn("", "\u63CF\u8FB9\u989C\u8272", () => {
          state.showColorPicker = !state.showColorPicker;
          state.showFillPicker = false;
          state.showWidthPicker = false;
          renderPopups();
        });
        const strokePreview = document.createElement("span");
        strokePreview.className = "wb-color-preview";
        strokePreview.style.background = state.strokeColor;
        strokeBtn.innerHTML = "";
        strokeBtn.appendChild(strokePreview);
        colorGroup.appendChild(strokeBtn);
        const fillBtn = makeBtn("", "\u586B\u5145\u989C\u8272", () => {
          state.showFillPicker = !state.showFillPicker;
          state.showColorPicker = false;
          state.showWidthPicker = false;
          renderPopups();
        });
        const fillPreview = document.createElement("span");
        fillPreview.className = "wb-color-preview wb-fill-preview";
        fillPreview.style.background = state.fillColor || "transparent";
        fillPreview.style.borderColor = state.fillColor || "#ccc";
        fillBtn.innerHTML = "";
        fillBtn.appendChild(fillPreview);
        colorGroup.appendChild(fillBtn);
        toolbarEl.appendChild(colorGroup);
        const widthGroup = document.createElement("div");
        widthGroup.className = "wb-tool-group";
        const widthBtn = makeBtn("", "\u7EBF\u5BBD", () => {
          state.showWidthPicker = !state.showWidthPicker;
          state.showColorPicker = false;
          state.showFillPicker = false;
          renderPopups();
        });
        const widthIndicator = document.createElement("span");
        widthIndicator.style.cssText = `display:block;width:16px;height:${Math.min(state.strokeWidth, 6)}px;background:#333;border-radius:2px;`;
        widthBtn.innerHTML = "";
        widthBtn.appendChild(widthIndicator);
        widthGroup.appendChild(widthBtn);
        toolbarEl.appendChild(widthGroup);
        const div3 = document.createElement("div");
        div3.className = "wb-divider";
        toolbarEl.appendChild(div3);
        const gridGroup = document.createElement("div");
        gridGroup.className = "wb-tool-group";
        gridGroup.appendChild(makeBtn(
          makeSVG('<path d="M3 3h18v18H3z"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>'),
          state.showGrid ? "\u9690\u85CF\u7F51\u683C" : "\u663E\u793A\u7F51\u683C",
          () => {
            state.showGrid = !state.showGrid;
            board.renderer.showGrid = state.showGrid;
            board.markDirty();
            renderToolbarUI();
          },
          state.showGrid
        ));
        toolbarEl.appendChild(gridGroup);
        const div4 = document.createElement("div");
        div4.className = "wb-divider";
        toolbarEl.appendChild(div4);
        const actionGroup = document.createElement("div");
        actionGroup.className = "wb-tool-group";
        actionGroup.appendChild(makeBtn(
          makeSVG('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
          "\u5BFC\u51FA",
          () => {
            state.showExport = !state.showExport;
            renderPopups();
          }
        ));
        actionGroup.appendChild(makeBtn(
          makeSVG('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
          "\u6E05\u7A7A\u753B\u5E03",
          () => {
            showConfirm("\u786E\u5B9A\u6E05\u7A7A\u753B\u5E03\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002").then((ok) => {
              if (ok) {
                board.clearAll();
                renderToolbarUI();
              }
            });
          }
        ));
        toolbarEl.appendChild(actionGroup);
      }
      function renderPopups() {
        if (!popupsEl) return;
        popupsEl.innerHTML = "";
        if (state.showColorPicker) {
          const popup = createColorPopup(COLORS, state.strokeColor, (c) => {
            state.strokeColor = c;
            board.currentStrokeColor = c;
            state.showColorPicker = false;
            for (const el of board.getSelectedElements()) el.strokeColor = c;
            board.history.push(board.elements);
            board.scheduleSave();
            board.markDirty();
            renderToolbarUI();
            renderPopups();
          });
          popupsEl.appendChild(popup);
        }
        if (state.showFillPicker) {
          const popup = createColorPopup(FILL_COLORS, state.fillColor, (c) => {
            state.fillColor = c;
            board.currentFillColor = c;
            state.showFillPicker = false;
            for (const el of board.getSelectedElements()) el.fillColor = c;
            board.history.push(board.elements);
            board.scheduleSave();
            board.markDirty();
            renderToolbarUI();
            renderPopups();
          });
          popupsEl.appendChild(popup);
        }
        if (state.showWidthPicker) {
          const popup = createWidthPopup(STROKE_WIDTHS, state.strokeWidth, (w) => {
            state.strokeWidth = w;
            board.currentStrokeWidth = w;
            state.showWidthPicker = false;
            for (const el of board.getSelectedElements()) el.strokeWidth = w;
            board.history.push(board.elements);
            board.scheduleSave();
            board.markDirty();
            renderToolbarUI();
            renderPopups();
          });
          popupsEl.appendChild(popup);
        }
        if (state.showExport) {
          const popup = createExportPopup();
          popupsEl.appendChild(popup);
        }
      }
      function createColorPopup(colors, current, onSelect) {
        const popup = document.createElement("div");
        popup.className = "wb-popup wb-color-picker";
        const header = document.createElement("div");
        header.className = "wb-popup-header";
        header.innerHTML = "<span>\u989C\u8272</span>";
        const closeBtn = document.createElement("button");
        closeBtn.className = "wb-popup-close";
        closeBtn.textContent = "\xD7";
        closeBtn.onclick = () => {
          state.showColorPicker = false;
          state.showFillPicker = false;
          renderPopups();
        };
        header.appendChild(closeBtn);
        popup.appendChild(header);
        const swatches = document.createElement("div");
        swatches.className = "wb-swatches";
        for (const c of colors) {
          const s = document.createElement("button");
          s.className = "wb-swatch" + (c === current ? " active" : "");
          s.style.background = c || "transparent";
          s.onclick = () => onSelect(c);
          swatches.appendChild(s);
        }
        popup.appendChild(swatches);
        return popup;
      }
      function createWidthPopup(widths, current, onSelect) {
        const popup = document.createElement("div");
        popup.className = "wb-popup wb-width-picker";
        const header = document.createElement("div");
        header.className = "wb-popup-header";
        header.innerHTML = "<span>\u7EBF\u5BBD</span>";
        const closeBtn = document.createElement("button");
        closeBtn.className = "wb-popup-close";
        closeBtn.textContent = "\xD7";
        closeBtn.onclick = () => {
          state.showWidthPicker = false;
          renderPopups();
        };
        header.appendChild(closeBtn);
        popup.appendChild(header);
        const options = document.createElement("div");
        options.className = "wb-width-options";
        for (const w of widths) {
          const opt = document.createElement("button");
          opt.className = "wb-width-option" + (w === current ? " active" : "");
          const bar = document.createElement("span");
          bar.style.cssText = `display:block;width:40px;height:${Math.min(w, 8)}px;background:#333;border-radius:2px;`;
          const label = document.createElement("span");
          label.className = "wb-width-label";
          label.textContent = w + "px";
          opt.appendChild(bar);
          opt.appendChild(label);
          opt.onclick = () => onSelect(w);
          options.appendChild(opt);
        }
        popup.appendChild(options);
        return popup;
      }
      function createExportPopup() {
        const overlay = document.createElement("div");
        overlay.className = "wb-export-overlay";
        overlay.onclick = (e) => {
          if (e.target === overlay) {
            state.showExport = false;
            renderPopups();
          }
        };
        const dialog = document.createElement("div");
        dialog.className = "wb-export-dialog";
        const header = document.createElement("div");
        header.className = "wb-export-header";
        header.innerHTML = "<span>\u5BFC\u51FA</span>";
        const closeBtn = document.createElement("button");
        closeBtn.className = "wb-popup-close";
        closeBtn.textContent = "\xD7";
        closeBtn.onclick = () => {
          state.showExport = false;
          renderPopups();
        };
        header.appendChild(closeBtn);
        dialog.appendChild(header);
        const options = document.createElement("div");
        options.className = "wb-export-options";
        const exports = [
          { icon: "\u{1F5BC}", label: "\u5BFC\u51FA\u4E3A PNG", fn: () => exportPng() },
          { icon: "\u{1F4F7}", label: "\u5BFC\u51FA\u4E3A JPG", fn: () => exportJpg() },
          { icon: "{ }", label: "\u5BFC\u51FA\u4E3A JSON", fn: () => exportJson() }
        ];
        for (const exp of exports) {
          const btn = document.createElement("button");
          btn.className = "wb-export-btn";
          btn.innerHTML = `<span class="wb-export-icon">${exp.icon}</span><span>${exp.label}</span>`;
          btn.onclick = () => {
            exp.fn();
            state.showExport = false;
            renderPopups();
          };
          options.appendChild(btn);
        }
        dialog.appendChild(options);
        overlay.appendChild(dialog);
        return overlay;
      }
      function exportPng() {
        const bounds = board.getWorldBounds(board.elements);
        if (!bounds) {
          ctx.ui.notify("\u753B\u5E03\u4E3A\u7A7A", "warn");
          return;
        }
        const pad = 20;
        const off = document.createElement("canvas");
        off.width = bounds.width + pad * 2;
        off.height = bounds.height + pad * 2;
        const c = off.getContext("2d");
        c.fillStyle = "#ffffff";
        c.fillRect(0, 0, off.width, off.height);
        c.translate(-bounds.x + pad, -bounds.y + pad);
        const origCtx = board.renderer.ctx;
        board.renderer.ctx = c;
        for (const el of board.elements) {
          c.save();
          c.globalAlpha = el.opacity ?? 1;
          board.renderer.renderElement(el);
          c.restore();
        }
        board.renderer.ctx = origCtx;
        off.toBlob((blob) => {
          if (blob) {
            downloadBlob2(blob, "whiteboard.png");
            ctx.ui.notify("PNG \u5BFC\u51FA\u5B8C\u6210");
          }
        });
      }
      function exportJpg() {
        const bounds = board.getWorldBounds(board.elements);
        if (!bounds) {
          ctx.ui.notify("\u753B\u5E03\u4E3A\u7A7A", "warn");
          return;
        }
        const pad = 20;
        const off = document.createElement("canvas");
        off.width = bounds.width + pad * 2;
        off.height = bounds.height + pad * 2;
        const c = off.getContext("2d");
        c.fillStyle = "#ffffff";
        c.fillRect(0, 0, off.width, off.height);
        c.translate(-bounds.x + pad, -bounds.y + pad);
        const origCtx = board.renderer.ctx;
        board.renderer.ctx = c;
        for (const el of board.elements) {
          c.save();
          c.globalAlpha = el.opacity ?? 1;
          board.renderer.renderElement(el);
          c.restore();
        }
        board.renderer.ctx = origCtx;
        off.toBlob((blob) => {
          if (blob) {
            downloadBlob2(blob, "whiteboard.jpg");
            ctx.ui.notify("JPG \u5BFC\u51FA\u5B8C\u6210");
          }
        }, "image/jpeg");
      }
      function exportJson() {
        const data = { version: 1, elements: board.elements, viewport: board.viewport.serialize(), background: "#ffffff" };
        downloadText2(JSON.stringify(data, null, 2), "whiteboard.json");
        ctx.ui.notify("JSON \u5BFC\u51FA\u5B8C\u6210");
      }
      function downloadBlob2(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
      function downloadText2(text, filename) {
        downloadBlob2(new Blob([text], { type: "application/json" }), filename);
      }
      function showConfirm(message) {
        return new Promise((resolve) => {
          const overlay = document.createElement("div");
          overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:100;";
          const dialog = document.createElement("div");
          dialog.style.cssText = "background:#fff;border-radius:12px;padding:24px;min-width:280px;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.18);text-align:center;font-family:var(--font-sans,-apple-system,BlinkMacSystemFont,sans-serif);";
          const msg = document.createElement("p");
          msg.style.cssText = "margin:0 0 20px;font-size:14px;color:#333;line-height:1.5;";
          msg.textContent = message;
          const btns = document.createElement("div");
          btns.style.cssText = "display:flex;gap:10px;justify-content:center;";
          const cancelBtn = document.createElement("button");
          cancelBtn.textContent = "\u53D6\u6D88";
          cancelBtn.style.cssText = "padding:8px 24px;border:1px solid #ddd;border-radius:8px;background:#fff;color:#666;font-size:13px;cursor:pointer;transition:background 0.15s;";
          cancelBtn.onmouseenter = () => cancelBtn.style.background = "#f5f5f5";
          cancelBtn.onmouseleave = () => cancelBtn.style.background = "#fff";
          const okBtn = document.createElement("button");
          okBtn.textContent = "\u786E\u5B9A";
          okBtn.style.cssText = "padding:8px 24px;border:none;border-radius:8px;background:#e53935;color:#fff;font-size:13px;cursor:pointer;transition:background 0.15s;";
          okBtn.onmouseenter = () => okBtn.style.background = "#c62828";
          okBtn.onmouseleave = () => okBtn.style.background = "#e53935";
          cancelBtn.onclick = () => {
            overlay.remove();
            resolve(false);
          };
          okBtn.onclick = () => {
            overlay.remove();
            resolve(true);
          };
          overlay.onclick = (e) => {
            if (e.target === overlay) {
              overlay.remove();
              resolve(false);
            }
          };
          btns.appendChild(cancelBtn);
          btns.appendChild(okBtn);
          dialog.appendChild(msg);
          dialog.appendChild(btns);
          overlay.appendChild(dialog);
          document.body.appendChild(overlay);
          cancelBtn.focus();
        });
      }
      function updateStatusBar() {
        if (!statusbarEl) return;
        const toolNames = {
          select: "\u9009\u62E9",
          pen: "\u753B\u7B14",
          marker: "\u9A6C\u514B\u7B14",
          highlighter: "\u8367\u5149\u7B14",
          eraser: "\u6A61\u76AE\u64E6",
          rectangle: "\u77E9\u5F62",
          ellipse: "\u692D\u5706",
          diamond: "\u83F1\u5F62",
          line: "\u7EBF\u6BB5",
          arrow: "\u7BAD\u5934",
          text: "\u6587\u672C",
          image: "\u56FE\u7247"
        };
        statusbarEl.innerHTML = "";
        const left = document.createElement("span");
        left.textContent = (toolNames[state.activeTool] || state.activeTool) + " | " + (board ? board.elements.length + " \u5143\u7D20" : "");
        statusbarEl.appendChild(left);
        const right = document.createElement("span");
        right.className = "wb-statusbar-right";
        const zoomOut = document.createElement("button");
        zoomOut.className = "wb-zoom-btn";
        zoomOut.title = "\u7F29\u5C0F (Ctrl+-)";
        zoomOut.textContent = "\u2212";
        zoomOut.onclick = () => {
          if (board) board.zoomOut();
        };
        right.appendChild(zoomOut);
        const zoomLabel = document.createElement("span");
        zoomLabel.className = "wb-zoom-label";
        zoomLabel.textContent = Math.round(state.zoom * 100) + "%";
        right.appendChild(zoomLabel);
        const zoomIn = document.createElement("button");
        zoomIn.className = "wb-zoom-btn";
        zoomIn.title = "\u653E\u5927 (Ctrl+=)";
        zoomIn.textContent = "+";
        zoomIn.onclick = () => {
          if (board) board.zoomIn();
        };
        right.appendChild(zoomIn);
        const zoomReset = document.createElement("button");
        zoomReset.className = "wb-zoom-btn";
        zoomReset.title = "\u91CD\u7F6E\u7F29\u653E (Ctrl+0)";
        zoomReset.textContent = "1:1";
        zoomReset.onclick = () => {
          if (board) {
            board.viewport.reset();
            board.markDirty();
          }
        };
        right.appendChild(zoomReset);
        statusbarEl.appendChild(right);
      }
      onUnmounted(() => {
        cleanupTextEdit();
        if (board) {
          board.save();
          board.dispose();
          board._disposed = true;
        }
      });
      return () => {
        return h("div", { ref: rootRef, class: "whiteboard-plugin" });
      };
    }
  };
  return { component, dispose() {
  } };
}
export {
  activate
};
