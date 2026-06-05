import { DEFAULTS } from '../constants.js';

export class EraserTool {
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
        y: from.y + (to.y - from.y) * t,
      };
      this._eraseAt(pt);
    }
  }

  _hitTestErase(point, el) {
    // Use bounding box check first
    const margin = this.eraserRadius;
    if (point.x < el.x - margin || point.x > el.x + el.width + margin ||
        point.y < el.y - margin || point.y > el.y + el.height + margin) {
      return false;
    }

    // For freehand, check distance to segments
    if (el.type === 'freehand' && el.points) {
      for (let i = 0; i < el.points.length - 1; i++) {
        const p0 = { x: el.x + el.points[i].x, y: el.y + el.points[i].y };
        const p1 = { x: el.x + el.points[i + 1].x, y: el.y + el.points[i + 1].y };
        if (this.board.hitTest.distToSegment(point, p0, p1) < this.eraserRadius) {
          return true;
        }
      }
      return false;
    }

    // For line, check distance to segment
    if (el.type === 'line' && el.points && el.points.length >= 2) {
      const p0 = { x: el.x + el.points[0].x, y: el.y + el.points[0].y };
      const p1 = { x: el.x + el.points[1].x, y: el.y + el.points[1].y };
      return this.board.hitTest.distToSegment(point, p0, p1) < this.eraserRadius;
    }

    // For other elements, bounding box check
    return true;
  }
}
