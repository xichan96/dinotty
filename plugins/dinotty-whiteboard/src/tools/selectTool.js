export class SelectTool {
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

    // Check if clicking on a resize handle of a selected element
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

    // Check if clicking on an element
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
      // Start selection rectangle
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
        height: Math.abs(point.y - this._startPoint.y),
      };
      // Draw selection rectangle
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
      case 'tl':
        newX = start.x + dx; newY = start.y + dy;
        newW = start.width - dx; newH = start.height - dy;
        break;
      case 'tc':
        newY = start.y + dy; newH = start.height - dy;
        break;
      case 'tr':
        newY = start.y + dy;
        newW = start.width + dx; newH = start.height - dy;
        break;
      case 'mr':
        newW = start.width + dx;
        break;
      case 'br':
        newW = start.width + dx; newH = start.height + dy;
        break;
      case 'bc':
        newH = start.height + dy;
        break;
      case 'bl':
        newX = start.x + dx;
        newW = start.width - dx; newH = start.height + dy;
        break;
      case 'ml':
        newX = start.x + dx; newW = start.width - dx;
        break;
    }

    if (constrain) {
      const size = Math.max(Math.abs(newW), Math.abs(newH));
      newW = size * Math.sign(newW || 1);
      newH = size * Math.sign(newH || 1);
    }

    // Prevent zero-size
    if (Math.abs(newW) < 2) newW = 2 * Math.sign(newW || 1);
    if (Math.abs(newH) < 2) newH = 2 * Math.sign(newH || 1);

    el.x = newX;
    el.y = newY;
    el.width = newW;
    el.height = newH;

    this.board.markDirty();
  }
}
