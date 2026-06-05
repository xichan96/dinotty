import { createRectangle, createEllipse, createDiamond, createLine, createArrow, normalizeShape } from '../elements/shapes.js';

export class ShapeTool {
  constructor(board, shapeType) {
    this.board = board;
    this.shapeType = shapeType;
    this._element = null;
    this._startPoint = null;
  }

  onPointerDown(point, e) {
    this._startPoint = point;
    this._element = this._createShape(point.x, point.y, 0, 0);
    if (this.shapeType === 'line' || this.shapeType === 'arrow') {
      this._element.points = [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
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

    // Shift constraint: square/circle
    if (e.shiftKey) {
      const size = Math.max(Math.abs(w), Math.abs(h));
      w = size * Math.sign(w || 1);
      h = size * Math.sign(h || 1);
    }

    if (this.shapeType === 'line' || this.shapeType === 'arrow') {
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
      if (this.shapeType === 'line' || this.shapeType === 'arrow') {
        const sx = this._startPoint.x;
        const sy = this._startPoint.y;
        // After onPointerMove, el.x/el.y may have shifted for right-to-left or
        // bottom-to-top draws. Recompute both points relative to final el origin.
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
      case 'rectangle': return createRectangle(x, y, w, h);
      case 'ellipse': return createEllipse(x, y, w, h);
      case 'diamond': return createDiamond(x, y, w, h);
      case 'line': return createLine(x, y, x, y);
      case 'arrow': return createArrow(x, y, x, y);
      default: return createRectangle(x, y, w, h);
    }
  }
}
