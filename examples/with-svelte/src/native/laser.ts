import { LaserPointer } from "@excalidraw/laser-pointer";

import type { Point } from "./scene";

/**
 * Keep all stroke simplification, smoothing and outline geometry in the
 * original Excalidraw laser-pointer package. This wrapper merely converts
 * native canvas coordinates and validates incoming pointer samples.
 */
export class NativeLaserStroke {
  private readonly stroke: LaserPointer;
  private samples = 0;

  constructor(zoom: number) {
    this.stroke = new LaserPointer({
      size: Math.max(1.5, Math.min(10, 3.2 / Math.max(0.2, zoom))),
      streamline: 0.4,
      simplify: 0,
      keepHead: true,
    });
  }

  add(point: Point, pressure = 0.5): Point[] {
    if (
      this.samples >= 2048 ||
      !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
      Math.abs(point.x) > 1e6 || Math.abs(point.y) > 1e6
    ) return this.outline();
    this.stroke.addPoint([
      point.x, point.y,
      Number.isFinite(pressure) ? Math.max(0.1, Math.min(1, pressure)) : 0.5,
    ]);
    this.samples++;
    return this.outline();
  }

  close(): Point[] {
    this.stroke.close();
    return this.outline();
  }

  private outline(): Point[] {
    try {
      return this.stroke.getStrokeOutline()
        .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
        .map(([x, y]) => ({ x, y }));
    } catch {
      return [];
    }
  }
}
