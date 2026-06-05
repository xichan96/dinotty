import { createFreehandElement, addPoint, finalizeFreehand } from '../elements/freehand.js';

export class PenTool {
  constructor(board, subType = 'pen') {
    this.board = board;
    this.subType = subType;
    this._element = null;
    this._lastPoint = null;
    this._throttleMs = 16; // ~60fps
    this._lastTime = 0;
  }

  onPointerDown(point, e) {
    this._element = createFreehandElement(this.subType);
    this._element.x = point.x;
    this._element.y = point.y;
    if (this.subType === 'pen') {
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
}
