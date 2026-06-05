import { Viewport } from './viewport.js';
import { History } from './history.js';
import { Renderer } from './renderer.js';
import { HitTest } from '../elements/hitTest.js';
import { SelectTool } from '../tools/selectTool.js';
import { PenTool } from '../tools/penTool.js';
import { EraserTool } from '../tools/eraserTool.js';
import { ShapeTool } from '../tools/shapeTool.js';
import { TextTool } from '../tools/textTool.js';
import { ImageTool } from '../tools/imageTool.js';
import { copyElements } from '../utils/clipboard.js';
import { DEFAULTS, LIMITS } from '../constants.js';

export class Board {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.pluginCtx = ctx;
    this.viewport = new Viewport();
    this.history = new History();
    this.renderer = new Renderer(canvas, this.viewport);
    this.hitTest = new HitTest();

    this.elements = [];
    this.selectedIds = new Set();
    this.activeTool = 'pen';
    this.currentTool = null;
    this.currentStrokeWidth = DEFAULTS.strokeWidth;
    this.currentStrokeColor = DEFAULTS.strokeColor;
    this.currentFillColor = DEFAULTS.fillColor;
    this.currentEraserRadius = DEFAULTS.eraserRadius;

    this.isPanning = false;
    this.isSpaceDown = false;
    this.lastPanPoint = null;

    // Multi-touch pinch-to-zoom state
    this._activePointers = new Map(); // pointerId → { x, y }
    this._pinching = false;
    this._pinchStartDist = 0;
    this._pinchStartZoom = 1;
    this._pinchCenter = { x: 0, y: 0 };
    this._pinchPointerIds = [];
    this._lastPinchCenter = null;

    // Inertia / momentum state
    this._velocity = { x: 0, y: 0 };
    this._lastPanTime = 0;
    this._panSamples = []; // recent (dx, dy, dt) for velocity averaging
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
      marker: new PenTool(this, 'marker'),
      highlighter: new PenTool(this, 'highlighter'),
      eraser: new EraserTool(this),
      rectangle: new ShapeTool(this, 'rectangle'),
      ellipse: new ShapeTool(this, 'ellipse'),
      diamond: new ShapeTool(this, 'diamond'),
      line: new ShapeTool(this, 'line'),
      arrow: new ShapeTool(this, 'arrow'),
      text: new TextTool(this),
      image: new ImageTool(this),
    };

    this._setupEvents();
    this._startRenderLoop();
  }

  _setupEvents() {
    const c = this.canvas;
    c.style.touchAction = 'none';

    c.addEventListener('pointerdown', this._onPointerDown.bind(this));
    c.addEventListener('pointermove', this._onPointerMove.bind(this));
    c.addEventListener('pointerup', this._onPointerUp.bind(this));
    c.addEventListener('pointercancel', this._onPointerUp.bind(this));
    c.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
    c.addEventListener('dblclick', this._onDblClick.bind(this));

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);

    this._onPaste = this._onPaste.bind(this);
    document.addEventListener('paste', this._onPaste);

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
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
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

    // Clear stale pointers from previous gestures (e.g. finger lifted outside canvas)
    if (!this._pinching && this._activePointers.size > 0 && !this._activePointers.has(e.pointerId)) {
      this._activePointers.clear();
    }

    this._activePointers.set(e.pointerId, screenPt);

    // Two-finger pinch: enter pinch mode
    if (this._activePointers.size === 2) {
      this._startPinch();
      return;
    }

    // Already pinching (3+ fingers), ignore
    if (this._pinching) return;

    // Middle-click or space+click → pan
    if (e.button === 1 || (e.button === 0 && this.isSpaceDown)) {
      this._stopInertia();
      this.isPanning = true;
      this.lastPanPoint = screenPt;
      this._panSamples = [];
      this._lastPanTime = performance.now();
      this.canvas.style.cursor = 'grabbing';
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

    // Update tracked pointer position
    if (this._activePointers.has(e.pointerId)) {
      this._activePointers.set(e.pointerId, screenPt);
    }

    // Pinch-zoom in progress
    if (this._pinching && this._activePointers.size >= 2) {
      this._updatePinch();
      return;
    }

    if (this.isPanning && this.lastPanPoint) {
      const dx = screenPt.x - this.lastPanPoint.x;
      const dy = screenPt.y - this.lastPanPoint.y;
      this.viewport.pan(dx, dy);
      this.lastPanPoint = screenPt;
      // Track velocity for inertia
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

    // End pinch when one finger lifts
    if (this._pinching) {
      if (this._activePointers.size < 2) {
        this._pinching = false;
        this._pinchPointerIds = [];
        this._lastPinchCenter = null;
        this._lastPinchTime = 0;
        // Clear any residual tool state so the remaining finger doesn't draw
        const tool = this.tools[this.activeTool];
        if (tool && tool.onPointerUp) {
          const screenPt = this._getCanvasPoint(e);
          const worldPt = this.viewport.screenToWorld(screenPt.x, screenPt.y);
          tool.onPointerUp(worldPt, e);
        }
        // Start inertia from pinch momentum
        const vel = this._computeVelocity();
        if (Math.abs(vel.x) > 1 || Math.abs(vel.y) > 1) {
          this._startInertia(vel.x, vel.y);
        }
        if (Math.abs(this._pinchVelocity) > 0.001) {
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
      this.canvas.style.cursor = '';
      // Start inertia from pan momentum
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

    // Stop inertia and cancel any in-progress tool operation
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

    // Zoom using logarithmic interpolation for smoother feel
    if (this._pinchStartDist > 0) {
      const scale = dist / this._pinchStartDist;
      // Log interpolation: zoom changes proportionally to log(scale)
      const logScale = Math.log2(scale);
      const rawZoom = this._pinchStartZoom * Math.pow(2, logScale);
      // Elastic bounce at limits
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
      // Zoom centered on current pinch midpoint
      this.viewport.x = center.x - (center.x - this.viewport.x) * ratio;
      this.viewport.y = center.y - (center.y - this.viewport.y) * ratio;

      // Track pinch velocity for inertia
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

    // Pan based on midpoint movement
    if (this._lastPinchCenter) {
      const dx = center.x - this._lastPinchCenter.x;
      const dy = center.y - this._lastPinchCenter.y;
      this.viewport.pan(dx, dy);

      // Track pan velocity for inertia (use same samples as single-finger pan)
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
      const dt = Math.min(now - lastTime, 32) / 16; // normalize to ~60fps
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
    const threshold = 0.0005;
    let lastTime = performance.now();

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(now - lastTime, 32) / 16;
      lastTime = now;

      v *= Math.pow(friction, dt);

      if (Math.abs(v) < threshold) {
        // Snap to limits if slightly outside
        this.viewport.zoom = Math.max(LIMITS.zoom.min, Math.min(LIMITS.zoom.max, this.viewport.zoom));
        this._inertiaFrame = null;
        this._dirty = true;
        return;
      }

      const oldZoom = this.viewport.zoom;
      const newZoom = Math.max(LIMITS.zoom.min * 0.8, Math.min(LIMITS.zoom.max * 1.2, oldZoom * Math.pow(2, v * dt)));
      const ratio = newZoom / oldZoom;
      this.viewport.zoom = newZoom;
      // Keep zoom centered on canvas center
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
    // Weighted average of recent samples (newer = more weight)
    let totalWeight = 0, vx = 0, vy = 0;
    for (let i = 0; i < samples.length; i++) {
      const w = (i + 1); // newer samples have higher weight
      const dt = samples[i].dt || 16;
      vx += (samples[i].dx / dt) * w;
      vy += (samples[i].dy / dt) * w;
      totalWeight += w;
    }
    return { x: vx / totalWeight * 16, y: vy / totalWeight * 16 }; // scale to per-frame
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

    if (this.activeTool === 'text') {
      this.tools.text.createAt(worldPt);
    } else {
      const hit = this.hitTest.pointTest(worldPt, this.elements);
      if (hit && hit.type === 'text') {
        this.tools.text.editElement(hit);
      }
    }
  }

  _onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const ctrl = e.ctrlKey || e.metaKey;

    if (e.code === 'Space' && !this.isSpaceDown) {
      this.isSpaceDown = true;
      this.canvas.style.cursor = 'grab';
      e.preventDefault();
      return;
    }

    if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
    if (ctrl && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); return; }
    if (ctrl && e.key === 'a') { e.preventDefault(); this.selectAll(); return; }
    if (ctrl && e.key === 'c') { e.preventDefault(); this.copySelected(); return; }
    if (ctrl && e.key === 'v') return; // handled by paste event

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (e.target === document.body || e.target === this.canvas) {
        e.preventDefault();
        this.deleteSelected();
      }
      return;
    }

    if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); this.zoomIn(); return; }
    if (ctrl && e.key === '-') { e.preventDefault(); this.zoomOut(); return; }
    if (ctrl && e.key === '0') { e.preventDefault(); this.viewport.reset(); this._dirty = true; return; }

    // Excalidraw-style single-key tool shortcuts
    if (!ctrl && !e.altKey && !e.metaKey) {
      const toolMap = {
        v: 'select', p: 'pen', e: 'eraser',
        r: 'rectangle', o: 'ellipse', d: 'diamond',
        l: 'line', a: 'arrow', t: 'text',
      };
      const tool = toolMap[e.key];
      if (tool) {
        this.setTool(tool);
        return;
      }

      // Number keys 1-0 for quick tool selection (Excalidraw style)
      const numToolMap = {
        '1': 'select', '2': 'rectangle', '3': 'diamond', '4': 'ellipse',
        '5': 'arrow', '6': 'line', '7': 'pen', '8': 'text', '9': 'eraser', '0': 'image',
      };
      const numTool = numToolMap[e.key];
      if (numTool) {
        this.setTool(numTool);
        if (numTool === 'image') this.tools.image.openFile();
        return;
      }

      // [ / ] to adjust pen width or eraser radius
      if (e.key === '[' || e.key === ']') {
        const delta = e.key === ']' ? 1 : -1;
        if (this.activeTool === 'eraser') {
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
    if (e.code === 'Space') {
      this.isSpaceDown = false;
      if (!this.isPanning) this.canvas.style.cursor = '';
    }
  }

  _onPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
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
    // Reset transform, apply DPR once
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

  markDirty() { this._dirty = true; }

  scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), 500);
  }

  async save() {
    try {
      await this.pluginCtx.storage.set('board', {
        version: 1,
        elements: this.elements,
        viewport: this.viewport.serialize(),
        background: '#ffffff',
      });
    } catch (e) {}
  }

  async load() {
    try {
      const data = await this.pluginCtx.storage.get('board');
      if (data) {
        this.elements = data.elements || [];
        this.viewport.deserialize(data.viewport);
        this.history.push(this.elements);
        this._dirty = true;
      }
    } catch (e) {}
  }

  setTool(name) {
    this.clearDrawingElement();
    this.activeTool = name;
    this.currentTool = this.tools[name];
    this._dirty = true;
    if (this._onToolChange) this._onToolChange(name);
  }

  setOnToolChange(cb) { this._onToolChange = cb; }

  getTool() { return this.activeTool; }

  addElement(el) {
    this.elements.push(el);
    this.history.push(this.elements);
    this.scheduleSave();
    this._dirty = true;
  }

  removeElement(id) {
    this.elements = this.elements.filter(e => e.id !== id);
    this.selectedIds.delete(id);
    this.history.push(this.elements);
    this.scheduleSave();
    this._dirty = true;
  }

  updateElement(id, updates) {
    const el = this.elements.find(e => e.id === id);
    if (el) {
      Object.assign(el, updates);
      this.history.push(this.elements);
      this.scheduleSave();
      this._dirty = true;
    }
  }

  setDrawingElement(el) { this._drawingElement = el; this._dirty = true; }
  clearDrawingElement() { this._drawingElement = null; this._dirty = true; }

  selectElement(id) { this.selectedIds.clear(); this.selectedIds.add(id); this._dirty = true; }
  addToSelection(id) { this.selectedIds.add(id); this._dirty = true; }
  toggleSelection(id) {
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
    this._dirty = true;
  }
  clearSelection() { this.selectedIds.clear(); this._dirty = true; }
  selectAll() { this.selectedIds.clear(); for (const el of this.elements) this.selectedIds.add(el.id); this._dirty = true; }
  getSelectedElements() { return this.elements.filter(el => this.selectedIds.has(el.id)); }

  deleteSelected() {
    if (this.selectedIds.size === 0) return;
    this.elements = this.elements.filter(el => !this.selectedIds.has(el.id));
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
    if (snapshot) { this.elements = snapshot; this.selectedIds.clear(); this.scheduleSave(); this._dirty = true; }
  }

  redo() {
    const snapshot = this.history.redo();
    if (snapshot) { this.elements = snapshot; this.selectedIds.clear(); this.scheduleSave(); this._dirty = true; }
  }

  zoomIn() {
    const c = this.canvas; const dpr = window.devicePixelRatio || 1;
    this.viewport.zoomAt(c.width / dpr / 2, c.height / dpr / 2, -100);
    this._dirty = true;
  }

  zoomOut() {
    const c = this.canvas; const dpr = window.devicePixelRatio || 1;
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
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('paste', this._onPaste);
    if (this._resizeObserver) this._resizeObserver.disconnect();
  }
}
