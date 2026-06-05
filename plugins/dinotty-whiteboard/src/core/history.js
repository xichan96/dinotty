import { LIMITS } from '../constants.js';

export class History {
  constructor() {
    this.stack = [];
    this.index = -1;
    this.maxSteps = LIMITS.history;
  }

  push(snapshot) {
    // Remove any redo states
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
}
