import { LIMITS } from '../constants.js';

export class Viewport {
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
      y: (sy - this.y) / this.zoom,
    };
  }

  // Convert world coordinates to screen coordinates
  worldToScreen(wx, wy) {
    return {
      x: wx * this.zoom + this.x,
      y: wy * this.zoom + this.y,
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
}
