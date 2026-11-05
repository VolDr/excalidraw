import { FONT_FAMILY, getLineHeight } from "@excalidraw/common";
import { getTextAnchorRatios, redrawTextBoundingBox } from "@excalidraw/element";

import type {
  ExcalidrawTextElement,
  FontFamilyValues,
} from "@excalidraw/element/types";

import { withNativeCoreScene } from "./coreAdapter";
import { nativeStyleTarget } from "./styles";

import type { SceneFile } from "./scene";

/**
 * Svelte exposes typography, but the original Excalidraw Scene owns updates
 * and redrawTextBoundingBox owns wrapping/font metrics. Never implement a
 * second text layout pipeline or mutate an imported document in place.
 */
export type NativeTypographyChange =
  | { key: "fontFamily"; value: FontFamilyValues }
  | { key: "fontSize"; value: number }
  | { key: "textAlign"; value: ExcalidrawTextElement["textAlign"] };

const ALLOWED_FONT_FAMILIES: readonly FontFamilyValues[] = [
  FONT_FAMILY.Virgil,
  FONT_FAMILY.Helvetica,
  FONT_FAMILY.Cascadia,
  FONT_FAMILY.Excalifont,
  FONT_FAMILY.Nunito,
];
const ALLOWED_FONT_SIZES = [12, 16, 20, 24, 28, 36, 48, 64, 72];

export const nativeTypographyTarget = (
  scene: SceneFile,
  id: string | null,
): ExcalidrawTextElement | null => {
  const element = nativeStyleTarget(scene, id);
  // For now, preserve complex rotation, bindings, group and frame layouts by
  // making them read-only in the Svelte typography panel.
  return element?.type === "text" &&
    element.containerId === null &&
    !element.boundElements?.length &&
    element.angle === 0 &&
    element.autoResize
    ? element
    : null;
};

export const applyNativeTypography = (
  scene: SceneFile,
  id: string,
  change: NativeTypographyChange,
): SceneFile => {
  const initial = nativeTypographyTarget(scene, id);
  if (!initial || initial[change.key] === change.value) {
    return scene;
  }

  if (change.key === "fontFamily" && !ALLOWED_FONT_FAMILIES.includes(change.value)) {
    return scene;
  }
  if (change.key === "fontSize" && !ALLOWED_FONT_SIZES.includes(change.value)) {
    return scene;
  }
  if (change.key === "textAlign" &&
      change.value !== "left" &&
      change.value !== "center" &&
      change.value !== "right") {
    return scene;
  }

  return withNativeCoreScene(scene, (core) => {
    const element = core.getNonDeletedElement(id);
    if (!element || element.type !== "text") {
      return;
    }

    // The Scene implementation, not the Svelte host, owns element versioning
    // and the font metrics pipeline. One core transaction = one undo step.
    if (change.key === "fontFamily") {
      core.mutateElement(element, {
        fontFamily: change.value,
        lineHeight: getLineHeight(change.value),
      });
    } else if (change.key === "fontSize") {
      core.mutateElement(element, {
        fontSize: change.value,
        baseFontSize: null,
      });
    } else {
      core.mutateElement(element, { textAlign: change.value });
    }
    redrawTextBoundingBox(element, null, core);

    // The same anchor ratios that Excalidraw uses to create standalone text
    // prevent growth from unexpectedly shifting center/right-aligned labels.
    const updated = core.getNonDeletedElement(id);
    if (!updated || updated.type !== "text") {
      return;
    }
    if (change.key !== "textAlign") {
      const anchor = getTextAnchorRatios(initial);
      core.mutateElement(updated, {
        x: initial.x + (initial.width - updated.width) * anchor.x,
        y: initial.y + (initial.height - updated.height) * anchor.y,
      });
    }
  });
};
