import {
  addElementsToFrame,
  getCommonBounds,
  getElementsInNewFrame,
  newFrameElement,
  removeAllElementsFromFrame,
} from "@excalidraw/element";
import type { ExcalidrawElement, ExcalidrawFrameElement } from "@excalidraw/element/types";

import { nativeElementsMap, updateNativeElement } from "./coreAdapter";
import { editableSelection } from "./groups";
import type { Point, SceneFile } from "./scene";

const finite = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y) &&
  Math.abs(p.x) <= 1e6 && Math.abs(p.y) <= 1e6;
const sourceCopy = (scene: SceneFile) =>
  scene.elements.map((element) => structuredClone(element));
const reuseUnchanged = (scene: SceneFile, after: ExcalidrawElement[]) => {
  const before = new Map(scene.elements.map((item) => [item.id, item]));
  return after.map((element) => {
    const old = before.get(element.id);
    return old && JSON.stringify(old) === JSON.stringify(element) ? old : element;
  });
};

/** Frame schema/seeds/metadata come from the original Excalidraw constructor. */
export const nativeFrameFromDrag = (
  start: Point, end: Point,
): ExcalidrawFrameElement | null => {
  if (!finite(start) || !finite(end)) return null;
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < 30 || height < 30) return null;
  return newFrameElement({ x, y, width, height });
};

/**
 * Frame creation uses the original getElementsInNewFrame and addElementsToFrame
 * rules (including complete-group membership and bound-text adjacency).
 * Do not manually assign frameIds or reorder fractional indices in Svelte.
 */
export const createNativeFrameWithCore = (
  scene: SceneFile,
  start: Point,
  end: Point,
): { scene: SceneFile; frame: ExcalidrawFrameElement } | null => {
  const frame = nativeFrameFromDrag(start, end);
  if (!frame) return null;
  try {
    const elements = sourceCopy(scene);
    const eligible = getElementsInNewFrame(
      elements, frame, nativeElementsMap({ elements }),
    ).filter((el) => !el.isDeleted && !el.frameId);
    const next = addElementsToFrame([...elements, frame], eligible, frame);
    if (!next.some((item) => item.id === frame.id) ||
        next.some((item) => item.id !== frame.id &&
          item.frameId === frame.id && !eligible.some((child) => child.id === item.id))) {
      return null;
    }
    return {
      scene: { ...scene, elements: reuseUnchanged(scene, next) },
      frame,
    };
  } catch {
    return null;
  }
};

/** Exact original frame bounds around a complete safe selection. */
export const wrapNativeSelectionInFrame = (
  scene: SceneFile,
  ids: readonly string[],
): { scene: SceneFile; frame: ExcalidrawFrameElement } | null => {
  const selected = new Set(ids);
  if (!selected.size || editableSelection(scene, ids).length !== selected.size) {
    return null;
  }
  const roots = scene.elements.filter((element) =>
    selected.has(element.id) && !element.isDeleted &&
    !element.frameId && element.type !== "frame",
  );
  if (roots.length !== selected.size) return null;
  const bounds = getCommonBounds(roots, nativeElementsMap(scene));
  if (!bounds.every(Number.isFinite)) return null;
  const pad = 25;
  const frame = newFrameElement({
    x: bounds[0] - pad,
    y: bounds[1] - pad,
    width: bounds[2] - bounds[0] + pad * 2,
    height: bounds[3] - bounds[1] + pad * 2,
  });
  try {
    const source = sourceCopy(scene);
    const withFrame = [...source, frame];
    const toAdd = source.filter((element) => selected.has(element.id));
    const added = addElementsToFrame(withFrame, toAdd, frame);
    if (added.filter((el) => selected.has(el.id))
      .some((el) => el.frameId !== frame.id)) return null;
    return {
      scene: { ...scene, elements: reuseUnchanged(scene, added) },
      frame,
    };
  } catch {
    return null;
  }
};

/** Remove only the frame, never its children, using original core unframing. */
export const unwrapNativeFrame = (
  scene: SceneFile,
  frameId: string,
): SceneFile => {
  const frame = scene.elements.find((element) => element.id === frameId);
  if (!frame || frame.type !== "frame" || frame.isDeleted || frame.locked) {
    return scene;
  }
  try {
    const source = sourceCopy(scene);
    const target = source.find((item) => item.id === frameId);
    if (!target || target.type !== "frame") return scene;
    removeAllElementsFromFrame(source, target);
    const next = source.map((item) => item.id === frameId
      ? updateNativeElement(item, { isDeleted: true }) : item
    );
    if (next.some((item) => item.frameId === frameId)) return scene;
    return { ...scene, elements: reuseUnchanged(scene, next) };
  } catch {
    return scene;
  }
};

/**
 * Frame names are first-class original Excalidraw metadata.
 * Svelte only delegates the immutable element edit to newElementWith.
 */
export const renameNativeFrame = (
  scene: SceneFile,
  id: string,
  value: string,
): SceneFile => {
  const frame = scene.elements.find((element) => element.id === id);
  const name = value.trim().slice(0, 120);
  if (
    !frame || frame.type !== "frame" ||
    frame.isDeleted || frame.locked ||
    (frame.name ?? "") === name
  ) return scene;
  const renamed = updateNativeElement(frame, { name: name || null });
  return {
    ...scene,
    elements: scene.elements.map((element) =>
      element.id === id ? renamed : element
    ),
  };
};
