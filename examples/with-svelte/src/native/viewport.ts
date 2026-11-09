import { getCommonBounds } from "@excalidraw/element";
import { zoomToFitBounds } from "@excalidraw/excalidraw";

import type { AppState } from "@excalidraw/excalidraw/types";

import { isNativeShape } from "./scene";

import type { Point, SceneFile } from "./scene";

export type NativeViewportFit = "all" | "selection";

/**
 * The original Excalidraw bounds and viewport fitting algorithm define the
 * scene position and zoom. Svelte only converts its pixel pan into the core's
 * scene-space scrollX/scrollY and back; it never reimplements fit geometry.
 */
export const fitNativeViewportWithCore = (
  scene: SceneFile,
  ids: readonly string[],
  mode: NativeViewportFit,
  viewportSize: Point,
  zoom: number,
  pixelPan: Point,
): { zoom: number; pan: Point } | null => {
  if (
    viewportSize.x <= 0 ||
    viewportSize.y <= 0 ||
    !Number.isFinite(zoom) ||
    zoom <= 0
  ) {
    return null;
  }

  const selected = new Set(ids);
  const elements = scene.elements.filter((element) =>
    isNativeShape(element) &&
    (mode === "all" || selected.has(element.id)),
  );
  if (!elements.length) {
    return null;
  }

  const bounds = getCommonBounds(elements);
  if (!bounds.every(Number.isFinite)) {
    return null;
  }
  const appState = {
    width: viewportSize.x,
    height: viewportSize.y,
    zoom: { value: zoom },
    scrollX: pixelPan.x / zoom,
    scrollY: pixelPan.y / zoom,
  } as AppState;

  const result = zoomToFitBounds({
    bounds,
    appState,
    canvasOffsets: { left: 24, right: 24, top: 24, bottom: 24 },
    fit: "contain",
    minZoom: 0.2,
    maxZoom: 5,
  });
  const nextZoom = result.appState.zoom.value;
  const x = result.appState.scrollX * nextZoom;
  const y = result.appState.scrollY * nextZoom;
  if (![nextZoom, x, y].every(Number.isFinite)) {
    return null;
  }
  return { zoom: nextZoom, pan: { x, y } };
};
