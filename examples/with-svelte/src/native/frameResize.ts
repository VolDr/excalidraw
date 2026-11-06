import {
  getTransformHandles,
  transformElements,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
  NonDeleted,
} from "@excalidraw/element/types";

import {
  nativeElementsMap,
  transformNativeGraphWithCore,
  withNativeCoreScene,
} from "./coreAdapter";
import type { CoreEditorController } from "@excalidraw/element";
import { reconcileNativeResizedFrameMembership } from "./frameMembership";

import type { Point, SceneFile } from "./scene";

export type NativeFrameHandle = "nw" | "ne" | "sw" | "se";
const cornerHandles: NativeFrameHandle[] = ["nw", "ne", "sw", "se"];

const eligibleFrame = (
  scene: SceneFile, id: string,
): ExcalidrawFrameElement | null => {
  const item = scene.elements.find((e) => e.id === id);
  if (!item || item.type !== "frame" || item.isDeleted || item.locked ||
      !!item.frameId || item.groupIds.length > 0 ||
      !!item.boundElements?.length ||
      item.angle !== 0 ||
      ![item.x, item.y, item.width, item.height].every(Number.isFinite) ||
      item.width < 30 || item.height < 30 ||
      scene.elements.some((el) => !el.isDeleted &&
        el.id !== id && (
          el.type === "arrow" && (
            el.startBinding?.elementId === id ||
            el.endBinding?.elementId === id
          ) || el.boundElements?.some((ref) => ref.id === id)
        ))) return null;
  const children = scene.elements.filter((el) => el.frameId === id);
  return children.every((el) =>
    !el.isDeleted && el.type !== "frame" && el.type !== "magicframe" &&
    [el.x, el.y, el.width, el.height].every(Number.isFinite)
  ) ? item : null;
};

/** Excalidraw core handle coordinates, without rotation: frames cannot rotate. */
export const nativeFrameHandleLocations = (
  scene: SceneFile,
  id: string,
  zoom: number,
): Partial<Record<NativeFrameHandle, Point>> => {
  const frame = eligibleFrame(scene, id);
  if (!frame || !Number.isFinite(zoom) || zoom <= 0) return {};
  try {
    const handles = getTransformHandles(
      frame, { value: zoom } as Parameters<typeof getTransformHandles>[1],
      nativeElementsMap(scene), "mouse",
    );
    const result: Partial<Record<NativeFrameHandle, Point>> = {};
    for (const key of cornerHandles) {
      const box = handles[key];
      if (box) result[key] = {
        x: box[0] + box[2] / 2,
        y: box[1] + box[3] / 2,
      };
    }
    return result;
  } catch {
    return {};
  }
};

export const pickNativeFrameHandle = (
  scene: SceneFile,
  id: string,
  at: Point,
  zoom: number,
  tolerance = 9,
): NativeFrameHandle | null => {
  for (const key of cornerHandles) {
    const point = nativeFrameHandleLocations(scene, id, zoom)[key];
    if (point && Math.hypot(at.x - point.x, at.y - point.y) <= tolerance) {
      return key;
    }
  }
  return null;
};

/**
 * Resize an original frame with original transformElements.
 *
 * Preserve the full original frame-membership algorithm: original
 * getElementsInResizingFrame proposes adoption/release of eligible roots.
 * Changes to reciprocal bound graphs or imported group ancestry are
 * rejected by frameMembership, without making a Svelte geometry fork.
 */
export const resizeNativeFrameWithCore = (
  scene: SceneFile,
  id: string,
  handle: NativeFrameHandle,
  pointer: Point,
  controller?: CoreEditorController,
): SceneFile => {
  const before = eligibleFrame(scene, id);
  if (!before || !cornerHandles.includes(handle) ||
      !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return scene;
  let next: SceneFile;
  try {
    next = controller
      ? transformNativeGraphWithCore(
          scene, [id], handle, pointer, controller, false,
        )
      : withNativeCoreScene(scene, (core) => {
      const frame = core.getNonDeletedElement(id);
      if (!frame || frame.type !== "frame") return;
      const originals = new Map(
        core.getNonDeletedElements().map((el) => [
          el.id, structuredClone(el),
        ]),
      ) as Map<string, NonDeleted<ExcalidrawElement>>;
      transformElements(
        originals, handle, [frame], core,
        false, false, false,
        pointer.x, pointer.y,
        before.x + before.width / 2,
        before.y + before.height / 2,
      );
    });
    const after = eligibleFrame(next, id);
    if (!after || next === scene ||
        after.width < 30 || after.height < 30 ||
        after.name !== before.name ||
        after.frameId !== before.frameId ||
        after.index !== before.index ||
        next.elements.some((el, index) =>
          el.id !== id && el !== scene.elements[index]
        )) return scene;

    return reconcileNativeResizedFrameMembership(scene, next, id);
  } catch {
    return scene;
  }
};
