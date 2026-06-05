export class HitTest {
  pointTest(point, elements) {
    // Test in reverse order (top elements first)
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
      case 'freehand': return this.hitFreehand(point, el);
      case 'line': return this.hitLine(point, el);
      case 'text':
      case 'rectangle':
      case 'ellipse':
      case 'diamond':
      case 'image':
        return this.hitBBox(point, el);
      default: return false;
    }
  }

  hitBBox(point, el) {
    return point.x >= el.x && point.x <= el.x + el.width &&
           point.y >= el.y && point.y <= el.y + el.height;
  }

  hitFreehand(point, el) {
    // First check bounding box
    if (!this.hitBBox(point, el)) return false;

    // Check distance to each segment
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
      const ex = p.x - a.x;
      const ey = p.y - a.y;
      return Math.sqrt(ex * ex + ey * ey);
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

    return !(rect.x > ex + ew || rect.x + rect.width < ex ||
             rect.y > ey + eh || rect.y + rect.height < ey);
  }
}
