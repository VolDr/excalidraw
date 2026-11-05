import type {
  Arrowhead,
  ExcalidrawElement,
  FillStyle,
  StrokeStyle,
} from "@excalidraw/element/types";

import { updateNativeElement } from "./coreAdapter";
import { canEditIndependently, editableSelection } from "./groups";
import { isNativeShape } from "./scene";

import type { SceneFile } from "./scene";

/**
 * The Svelte property panel is deliberately a UI adapter for Excalidraw's
 * immutable element update mechanism, not another drawing/style engine.
 *
 * Only independent native roots are editable here. Groups, captions,
 * linked arrows, frames and damaged external references must go through
 * their full Excalidraw lifecycle before exposing style transactions.
 */
export type NativeStyleChange =
  | { key: "strokeColor"; value: string }
  | { key: "backgroundColor"; value: string }
  | { key: "strokeWidth"; value: 1 | 2 | 4 }
  | { key: "strokeStyle"; value: StrokeStyle }
  | { key: "fillStyle"; value: FillStyle }
  | { key: "roughness"; value: 0 | 1 | 2 }
  | { key: "opacity"; value: number }
  | { key: "startArrowhead" | "endArrowhead"; value: Arrowhead | null };

const isHexColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

export function nativeStyleTarget(
  scene: SceneFile,
  id: string | null,
): ExcalidrawElement | null {
  if (!id) {
    return null;
  }
  const element = scene.elements.find((candidate) => candidate.id === id);
  if (
    !element ||
    !isNativeShape(element) ||
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
): SceneFile {
  const element = nativeStyleTarget(scene, id);
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
