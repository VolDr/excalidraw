import { cropElement, getUncroppedImageElement } from "@excalidraw/element";
import { pointFrom, pointRotateRads } from "@excalidraw/math";

import { nativeElementsMap, updateNativeElement } from "./coreAdapter";
import { imageSourceRect, nativeImageSource } from "./images";
import { nativeStyleTarget } from "./styles";

import type { SceneFile } from "./scene";

/**
 * Restore the complete visible image using Excalidraw's own crop geometry.
 * The core handles rotated/flipped image positioning; the Svelte adapter
 * only validates imported geometry and commits the immutable element update.
 */
export const resetNativeImageCrop = (
  scene: SceneFile,
  id: string,
): SceneFile => {
  const element = nativeStyleTarget(scene, id);
  if (
    element?.type !== "image" ||
    !element.crop ||
    !nativeImageSource(scene, element) ||
    !imageSourceRect(element, element.crop.naturalWidth, element.crop.naturalHeight)
  ) {
    return scene;
  }

  const uncropped = getUncroppedImageElement(
    element,
    nativeElementsMap(scene),
  );
  if (
    uncropped.crop !== null ||
    ![uncropped.x, uncropped.y, uncropped.width, uncropped.height].every(
      Number.isFinite,
    ) ||
    uncropped.width <= 0 ||
    uncropped.height <= 0
  ) {
    return scene;
  }

  const next = updateNativeElement(element, {
    x: uncropped.x,
    y: uncropped.y,
    width: uncropped.width,
    height: uncropped.height,
    crop: null,
  });
  if (next === element) {
    return scene;
  }
  return {
    ...scene,
    elements: scene.elements.map((item) =>
      item.id === element.id ? next : item,
    ),
  };
};

/**
 * Native UI request to crop each side by 10%, using Excalidraw's original
 * cropElement algorithm. Only the virtual drag target is Svelte-owned.
 */
export function cropNativeImageCenter(
  scene: SceneFile,
  id: string,
  naturalSize: { width: number; height: number },
): SceneFile {
  const element = nativeStyleTarget(scene, id);
  if (
    element?.type !== "image" ||
    !nativeImageSource(scene, element) ||
    ![naturalSize.width, naturalSize.height].every(
      (n) => Number.isFinite(n) && n > 0,
    ) ||
    !imageSourceRect(element, naturalSize.width, naturalSize.height) ||
    element.width <= 0 ||
    element.height <= 0
  ) {
    return scene;
  }

  // Resizing the southeast handle to 90% from the origin with center-resize
  // enabled gives 80% of the displayed image along both axes. Core owns the
  // actual crop rectangle, clipping limits and rotated/flip positioning.
  const center = pointFrom(
    element.x + element.width / 2,
    element.y + element.height / 2,
  );
  const pointer = pointRotateRads(
    pointFrom(
      element.x + element.width * 0.9,
      element.y + element.height * 0.9,
    ),
    center,
    element.angle,
  );
  const update = cropElement(
    element,
    nativeElementsMap(scene),
    "se",
    naturalSize.width,
    naturalSize.height,
    pointer[0],
    pointer[1],
    { shouldResizeFromCenter: true, shouldMaintainAspectRatio: true },
  );
  const candidate = { ...element, ...update };
  if (
    ![candidate.x, candidate.y, candidate.width, candidate.height].every(
      Number.isFinite,
    ) ||
    candidate.width <= 0 ||
    candidate.height <= 0 ||
    !imageSourceRect(candidate, naturalSize.width, naturalSize.height)
  ) {
    return scene;
  }

  const next = updateNativeElement(element, update);
  if (next === element) {
    return scene;
  }
  return {
    ...scene,
    elements: scene.elements.map((item) =>
      item.id === id ? next : item,
    ),
  };
}
