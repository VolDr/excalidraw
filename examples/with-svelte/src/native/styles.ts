import { ROUNDNESS } from "@excalidraw/common";

import type {
  Arrowhead,
  ExcalidrawElement,
  FillStyle,
  StrokeStyle,
} from "@excalidraw/element/types";

import { updateNativeElement } from "./coreAdapter";
import { editableNativeGroupSelection } from "./groupEditing";
import { canEditIndependently, editableSelection } from "./groups";
import { isNativeShape } from "./scene";

import type { SceneFile } from "./scene";

/**
 * The Svelte property panel is deliberately a UI adapter for Excalidraw's
 * immutable element update mechanism, not another drawing/style engine.
 *
 * Outside group editing, only independent native roots are editable.
 * Inside a validated editingGroupId we can style a single independent
 * child without touching group ancestry or reciprocal external bindings.
 * Excalidraw's newElementWith still owns update and version semantics.
 */
export type NativeStyleChange =
  | { key: "strokeColor"; value: string }
  | { key: "backgroundColor"; value: string }
  | { key: "strokeWidth"; value: 1 | 2 | 4 }
  | { key: "strokeStyle"; value: StrokeStyle }
  | { key: "fillStyle"; value: FillStyle }
  | { key: "roughness"; value: 0 | 1 | 2 }
  | { key: "roundness"; value: "round" | "sharp" }
  | { key: "opacity"; value: number }
  | { key: "startArrowhead" | "endArrowhead"; value: Arrowhead | null };

const isHexColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

export function nativeStyleTarget(
  scene: SceneFile,
  id: string | null,
  editingGroupId: string | null = null,
): ExcalidrawElement | null {
  if (!id) {
    return null;
  }
  const element = scene.elements.find((candidate) => candidate.id === id);
  if (!element || !isNativeShape(element) || element.type === "frame") return null;
  if (editingGroupId) {
    if (
      editableNativeGroupSelection(scene, [id], editingGroupId).length !== 1 ||
      element.isDeleted ||
      element.locked ||
      !!element.frameId ||
      !!element.boundElements?.length ||
      (element.type === "text" && element.containerId !== null) ||
      (element.type === "arrow" &&
        !!(element.startBinding || element.endBinding))
    ) return null;
  } else if (
    !canEditIndependently(element) ||
    editableSelection(scene, [id]).length !== 1
  ) {
    return null;
  }
  return element;
}

export function applyNativeStyle(
  scene: SceneFile,
  id: string,
  change: NativeStyleChange,
  editingGroupId: string | null = null,
): SceneFile {
  const element = nativeStyleTarget(scene, id, editingGroupId);
  if (!element) {
    return scene;
  }
  switch (change.key) {
    case "strokeColor":
      if (!isHexColor(change.value) || element.type === "image") {
        return scene;
      }
      break;
    case "backgroundColor":
      if (
        element.type !== "rectangle" &&
        element.type !== "ellipse" &&
        element.type !== "diamond" &&
        element.type !== "line"
      ) {
        return scene;
      }
      if (change.value !== "transparent" && !isHexColor(change.value)) {
        return scene;
      }
      break;
    case "strokeWidth":
      if (
        ![1, 2, 4].includes(change.value) ||
        element.type === "image" ||
        element.type === "text"
      ) {
        return scene;
      }
      break;
    case "strokeStyle":
      if (
        !["solid", "dashed", "dotted"].includes(change.value) ||
        element.type === "image" ||
        element.type === "text"
      ) {
        return scene;
      }
      break;
    case "fillStyle":
      if (
        !["hachure", "cross-hatch", "solid", "zigzag"].includes(change.value) ||
        !["rectangle", "ellipse", "diamond", "line"].includes(element.type)
      ) {
        return scene;
      }
      break;
    case "roughness":
      if (
        ![0, 1, 2].includes(change.value) ||
        element.type === "image" ||
        element.type === "text"
      ) {
        return scene;
      }
      break;
    case "roundness":
      if (
        !["rectangle", "diamond", "line", "image"].includes(element.type) ||
        (change.value !== "round" && change.value !== "sharp")
      ) {
        return scene;
      }
      break;
    case "opacity":
      if (
        !Number.isFinite(change.value) ||
        change.value < 0 ||
        change.value > 100 ||
        !Number.isInteger(change.value)
      ) {
        return scene;
      }
      break;
    case "startArrowhead":
    case "endArrowhead":
      if (
        element.type !== "arrow" ||
        element.elbowed ||
        element.startBinding ||
        element.endBinding ||
        ![null, "arrow", "triangle", "bar", "circle", "diamond"].includes(
          change.value,
        )
      ) {
        return scene;
      }
      break;
  }

  // Narrow discriminated keys for TypeScript and keep updates structurally
  // typed against Excalidraw element variants (arrowheads are arrow-only).
  let updated: ExcalidrawElement;
  switch (change.key) {
    case "strokeColor":
      updated = updateNativeElement(element, { strokeColor: change.value });
      break;
    case "backgroundColor":
      updated = updateNativeElement(element, { backgroundColor: change.value });
      break;
    case "strokeWidth":
      updated = updateNativeElement(element, { strokeWidth: change.value });
      break;
    case "strokeStyle":
      updated = updateNativeElement(element, { strokeStyle: change.value });
      break;
    case "fillStyle":
      updated = updateNativeElement(element, { fillStyle: change.value });
      break;
    case "roughness":
      updated = updateNativeElement(element, { roughness: change.value });
      break;
    case "roundness": {
      if (!!element.roundness === (change.value === "round")) {
        return scene;
      }
      const type = element.type === "diamond" || element.type === "line"
        ? ROUNDNESS.PROPORTIONAL_RADIUS
        : ROUNDNESS.ADAPTIVE_RADIUS;
      updated = updateNativeElement(element, {
        roundness: change.value === "sharp" ? null : { type },
      });
      break;
    }
    case "opacity":
      updated = updateNativeElement(element, { opacity: change.value });
      break;
    case "startArrowhead":
      if (element.type !== "arrow") {
        return scene;
      }
      updated = updateNativeElement(element, { startArrowhead: change.value });
      break;
    case "endArrowhead":
      if (element.type !== "arrow") {
        return scene;
      }
      updated = updateNativeElement(element, { endArrowhead: change.value });
      break;
  }
  if (updated === element) {
    return scene;
  }
  return {
    ...scene,
    elements: scene.elements.map((candidate) =>
      candidate.id === id ? updated : candidate,
    ),
  };
}
