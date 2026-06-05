import { createTextElement, resizeTextElement } from '../elements/text.js';

export class TextTool {
  constructor(board) {
    this.board = board;
    this._editCallback = null;
  }

  onPointerDown(point, e) {
    // Single click does nothing for text tool, double-click creates
  }

  onPointerMove(point, e) {
    // No-op
  }

  onPointerUp(point, e) {
    // No-op
  }

  createAt(point) {
    const el = createTextElement(point.x, point.y, '');
    this.board.addElement(el);
    this._startEditing(el);
  }

  editElement(el) {
    this._startEditing(el);
  }

  _startEditing(el) {
    // Store edit callback so UI can access it
    this._editCallback = el;
    // Dispatch custom event for the UI component to handle
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
}
