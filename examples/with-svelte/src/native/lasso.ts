import { getElementLineSegments } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { GlobalPoint } from "@excalidraw/math/types";

// The exact source of the React editor's lasso geometry is a pure function.
// Reuse it directly instead of implementing another polygon intersection.
// eslint-disable-next-line import/no-relative-packages
import { getLassoSelectedElementIds } from "../../../../packages/excalidraw/lasso/utils";

import { nativeElementsMap } from "./coreAdapter";
import { editableSelection, selectionUnit } from "./groups";

import type { Point, SceneFile } from "./scene";

export type NativeLassoMode = "contain" | "overlap";

/** Original Excalidraw lasso hit tests; native guards still own editability. */
export const elementsInNativeLasso = (
  scene: SceneFile,
  path: readonly Point[],
  mode: NativeLassoMode = "contain",
  zoom = 1,
): string[] => {
  if (
    path.length < 3 || path.length > 4096 ||
    !Number.isFinite(zoom) || zoom <= 0 ||
    path.some((p) =>
      !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
      Math.abs(p.x) > 1e6 || Math.abs(p.y) > 1e6
    )
  ) return [];

  const map = nativeElementsMap(scene);
  const candidates = scene.elements.filter((el) =>
    !el.isDeleted && !el.locked &&
    !(el.type === "text" && el.containerId !== null) &&
    selectionUnit(scene, el.id).length > 0
  );
  if (!candidates.length) return [];

  try {
    const segments = new Map(
      candidates.map((el) => [
        el.id, getElementLineSegments(el, map),
      ]),
    );
    const { selectedElementIds } = getLassoSelectedElementIds({
      lassoPath: path.map(({ x, y }) => pointFrom<GlobalPoint>(x, y)),
      elements: candidates,
      elementsMap: map,
      elementsSegments: segments,
      intersectedElements: new Set<string>(),
      enclosedElements: new Set<string>(),
      simplifyDistance: 5 / zoom,
      mode,
    });
    const selected = new Set<string>();
    for (const id of selectedElementIds) {
      for (const rootId of selectionUnit(scene, id)) {
        selected.add(rootId);
      }
    }
    const ordered = scene.elements
      .filter((el) => selected.has(el.id))
      .map((el) => el.id);
    // Partial, locked, imported or incorrectly linked group members are
    // never surfaced as a native draggable selection.
    const safe = editableSelection(scene, ordered);
    return safe.length === ordered.length ? safe : [];
  } catch {
    // Invalid legacy shapes cannot throw into pointer handlers.
    return [];
  }
};
