// Catmull-Rom spline interpolation for smooth freehand curves
export function catmullRomSpline(points, tension = 0.5, numSegments = 8) {
  if (points.length < 2) return points;
  if (points.length === 2) return points;

  const result = [];
  result.push(points[0]);

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[Math.min(points.length - 1, i + 1)];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    for (let t = 1; t <= numSegments; t++) {
      const s = t / numSegments;
      const s2 = s * s;
      const s3 = s2 * s;

      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * s +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s3
      );

      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * s +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s3
      );

      result.push({ x, y });
    }
  }

  return result;
}

// Simple moving average smoothing (lighter weight)
export function smoothPoints(points, windowSize = 3) {
  if (points.length <= windowSize) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    let sumX = 0, sumY = 0, count = 0;
    for (let j = Math.max(0, i - windowSize); j <= Math.min(points.length - 1, i + windowSize); j++) {
      sumX += points[j].x;
      sumY += points[j].y;
      count++;
    }
    result.push({ x: sumX / count, y: sumY / count });
  }
  result.push(points[points.length - 1]);
  return result;
}
