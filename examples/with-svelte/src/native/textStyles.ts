import { FONT_FAMILY, getLineHeight } from "@excalidraw/common";
import { getTextAnchorRatios, redrawTextBoundingBox } from "@excalidraw/element";

import type {
  ExcalidrawTextElement,
  FontFamilyValues,
} from "@excalidraw/element/types";

import { nativeEditableLabel } from "./boundText";
import { isSafeBoundBox } from "./bindings";
import { withNativeCoreScene } from "./coreAdapter";
import { nativeStyleTarget } from "./styles";

import type { SceneFile } from "./scene";

/**
 * Svelte exposes typography for standalone text and validated reciprocal
 * box captions. The original Excalidraw Scene owns immutable transactions,
 * wrapping, font metrics and growing bound-text containers. Never implement
 * a second text layout pipeline or mutate imported source elements.
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
  editingGroupId: string | null = null,
): ExcalidrawTextElement | null => {
  if (!id) {
    return null;
  }
  const selected = scene.elements.find((element) => element.id === id);
  if (!selected || selected.isDeleted || selected.locked) {
    return null;
  }

  // Standalone typography: preserve the existing conservative policy.
  if (selected.type === "text") {
    const element = nativeStyleTarget(scene, id, editingGroupId);
    return element?.type === "text" &&
      element.containerId === null &&
      !element.boundElements?.length &&
      element.angle === 0 &&
      element.autoResize
      ? element
      : null;
  }

  // A selected box owns its reciprocal label. The core redraw below can
  // change both label metrics and container dimensions atomically.
  // Do not expose arbitrary arrow-bound, nested or grouped containers.
  if (
    selected.groupIds.length ||
    !isSafeBoundBox(scene, selected) ||
    selected.boundElements?.length !== 1 ||
    selected.boundElements[0].type !== "text"
  ) {
    return null;
  }
  return nativeEditableLabel(scene, selected) ?? null;
};

export const applyNativeTypography = (
  scene: SceneFile,
  id: string,
  change: NativeTypographyChange,
  editingGroupId: string | null = null,
): SceneFile => {
  const initial = nativeTypographyTarget(scene, id, editingGroupId);
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
    const element = core.getNonDeletedElement(initial.id);
    if (!element || element.type !== "text") {
      return;
    }
    const container = initial.containerId
      ? core.getNonDeletedElement(initial.containerId)
      : null;
    if (initial.containerId && !container) {
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
    redrawTextBoundingBox(element, container, core);

    // The same anchor ratios that Excalidraw uses to create standalone text
    // prevent growth from unexpectedly shifting center/right-aligned labels.
    const updated = core.getNonDeletedElement(initial.id);
    if (!updated || updated.type !== "text") {
      return;
    }
    if (!container && change.key !== "textAlign") {
      const anchor = getTextAnchorRatios(initial);
      core.mutateElement(updated, {
        x: initial.x + (initial.width - updated.width) * anchor.x,
        y: initial.y + (initial.height - updated.height) * anchor.y,
      });
    }
  });
};
