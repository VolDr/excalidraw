import { getUncroppedImageElement } from "@excalidraw/element";

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
