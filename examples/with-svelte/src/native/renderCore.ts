import { getCreatePath, getElementAbsoluteCoords, paintImageElementOnCanvas, paintTextElementOnCanvas, ShapeCache } from "@excalidraw/element";
import { applyDarkModeFilter } from "@excalidraw/common";

import type { ElementsMap, ExcalidrawElement, ExcalidrawImageElement, ExcalidrawTextElement } from "@excalidraw/element/types";
import type { StaticCanvasRenderConfig } from "@excalidraw/excalidraw/scene/types";
import type { RoughCanvas } from "roughjs/bin/canvas";
import type { Drawable } from "roughjs/bin/core";

/**
 * The Svelte canvas hosts Excalidraw's existing RoughJS drawables instead of
 * independently generating boxes, curves or arrowheads. Only the scene-to-
 * canvas transform belongs to this framework adapter.
 */
export type CoreDrawableElement = Extract<
  ExcalidrawElement,
  { type: "rectangle" | "ellipse" | "diamond" | "line" | "arrow" | "freedraw" }
>;

export const isCoreDrawableElement = (
  element: ExcalidrawElement,
): element is CoreDrawableElement =>
  element.type === "rectangle" ||
  element.type === "ellipse" ||
  element.type === "diamond" ||
  element.type === "line" ||
  element.type === "arrow" ||
  element.type === "freedraw";

const emptyEmbedsValidationStatus = new Map<string, boolean>();

export function paintCoreDrawableElement(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  element: CoreDrawableElement,
  elementsMap: ElementsMap,
  theme: "light" | "dark",
  canvasBackgroundColor: string,
): void {
  // Match Excalidraw's export renderer: drawables are in local coordinates,
  // rotated about the core's absolute element center, not a handmade bbox.
  const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);
  const centerX = (x1 + x2) / 2;
  const centerY = (y1 + y2) / 2;

  const shapes = ShapeCache.generateElementShape(element, {
    isExporting: false,
    canvasBackgroundColor,
    embedsValidationStatus: emptyEmbedsValidationStatus,
    theme,
  });

  ctx.save();
  try {
    ctx.globalAlpha *= element.opacity / 100;
    ctx.translate(centerX, centerY);
    ctx.rotate(element.angle);
    ctx.translate(element.x - centerX, element.y - centerY);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const paintShape = (shape: Drawable | string) => {
      if (typeof shape === "string") {
        // Excalidraw fills the pressure-sensitive SVG outline, rather than
        // stroking pointer samples with a custom native polyline.
        ctx.fillStyle = applyDarkModeFilter(
          element.strokeColor,
          theme === "dark",
        );
        ctx.fill(getCreatePath()(shape));
      } else {
        rc.draw(shape);
      }
    };
    if (Array.isArray(shapes)) {
      for (const shape of shapes) {
        paintShape(shape);
      }
    } else {
      paintShape(shapes);
    }
  } finally {
    ctx.restore();
  }
}

/**
 * Same local-coordinate text painter used by the original renderer.
 * Native layouts (including validated reciprocal box captions) supply the
 * position; glyph shaping, RTL and multiline baselines remain core-owned.
 */
export function paintCoreTextElement(
  ctx: CanvasRenderingContext2D,
  element: ExcalidrawTextElement,
  theme: "light" | "dark",
): void {
  ctx.save();
  try {
    ctx.globalAlpha *= element.opacity / 100;
    ctx.translate(element.x + element.width / 2, element.y + element.height / 2);
    ctx.rotate(element.angle);
    ctx.translate(-element.width / 2, -element.height / 2);
    paintTextElementOnCanvas(element, ctx, theme);
  } finally {
    ctx.restore();
  }
}

/**
 * Forward embedded raster data through Excalidraw's original image painter.
 * Keep binary decoding, scene validation and the fallback placeholder in
 * Svelte; core owns crop source coordinates, rounded clipping and drawing.
 */
export function paintCoreImageElement(
  ctx: CanvasRenderingContext2D,
  element: ExcalidrawImageElement,
  image: HTMLImageElement,
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif",
  theme: "light" | "dark",
  scale: number,
): boolean {
  if (!element.fileId || element.isDeleted || element.width <= 0 || element.height <= 0) {
    return false;
  }

  const imageCache: StaticCanvasRenderConfig["imageCache"] = new Map();
  imageCache.set(element.fileId, { image, mimeType });

  ctx.save();
  try {
    ctx.globalAlpha *= element.opacity / 100;
    ctx.translate(
      element.x + element.width / 2,
      element.y + element.height / 2,
    );
    ctx.rotate(element.angle);
    ctx.scale(element.scale[0], element.scale[1]);
    ctx.translate(-element.width / 2, -element.height / 2);
    paintImageElementOnCanvas(element, ctx, {
      imageCache,
      theme,
      scale,
    });
    return true;
  } finally {
    ctx.restore();
  }
}
