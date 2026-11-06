import {
  getElementsInResizingFrame,
  getTransformHandles,
  transformElements,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
  NonDeleted,
} from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { nativeElementsMap, withNativeCoreScene } from "./coreAdapter";

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
 * While full React frame-membership updates are not connected to Svelte,
 * accept ONLY resizing that retains exactly the previous child set. This
 * avoids silently capturing nearby elements or dropping clipped children.
 * The original getElementsInResizingFrame determines the eligible set.
 */
export const resizeNativeFrameWithCore = (
  scene: SceneFile,
  id: string,
  handle: NativeFrameHandle,
  pointer: Point,
): SceneFile => {
  const before = eligibleFrame(scene, id);
  if (!before || !cornerHandles.includes(handle) ||
      !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return scene;
  let next: SceneFile;
  try {
    next = withNativeCoreScene(scene, (core) => {
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

    const previousChildren = new Set(
      scene.elements.filter((el) => el.frameId === id).map((el) => el.id),
    );
    // The original frame membership algorithm requires AppState solely
    // for group selection; no UI state or React component is involved.
    const state = {
      editingGroupId: null,
      selectedElementIds: { [id]: true },
      selectedGroupIds: {},
    } as unknown as AppState;
    const eligible = getElementsInResizingFrame(
      next.elements, after, state, nativeElementsMap(next),
    );
    const nextChildren = new Set(eligible.map((el) => el.id));
    if (
      previousChildren.size !== nextChildren.size ||
      [...previousChildren].some((child) => !nextChildren.has(child))
    ) return scene;
    return next;
  } catch {
    return scene;
  }
};
