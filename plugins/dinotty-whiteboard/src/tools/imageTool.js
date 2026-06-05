import { createImageElement, loadImage, constrainImageSize } from '../elements/image.js';

export class ImageTool {
  constructor(board) {
    this.board = board;
  }

  onPointerDown(point, e) {
    // No-op: image insertion is triggered from toolbar
  }

  onPointerMove(point, e) {
    // No-op
  }

  onPointerUp(point, e) {
    // No-op
  }

  openFile(atPoint) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
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
      // ignore image load errors
    }
  }
}
