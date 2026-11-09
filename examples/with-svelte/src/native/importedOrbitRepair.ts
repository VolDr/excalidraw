import {
  bindBindingElement,
  isElbowArrow,
  validateElbowPoints,
} from "@excalidraw/element";
import type {
  ExcalidrawBindableElement,
  ExcalidrawElement,
  NonDeleted,
  ExcalidrawElbowArrowElement,
} from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { nativeEditableComplexElbow } from "./complexElbow";
import { withNativeCoreScene } from "./coreAdapter";
import type { SceneFile } from "./scene";

type MissingOrbit = { arrowId: string; boxId: string; end: "start" | "end" };
const shape = (el: ExcalidrawElement) =>
  ["rectangle", "ellipse", "diamond"].includes(el.type);
const finite = (p: readonly number[]) =>
  p.length === 2 && p.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e6);

/**
 * Detect valid imported orbit elbow endpoints with only a missing reverse
 * box.boundElements record. Do not change foreign/corrupt binding modes,
 * group ancestry, nonorthogonal points or arbitrary editor extensions.
 */
export const missingNativeImportedOrbitBindings = (
  scene: SceneFile,
): MissingOrbit[] => {
  const byId = new Map(scene.elements.map((item) => [item.id, item]));
  const output: MissingOrbit[] = [];
  for (const arrow of scene.elements) {
    if (!isElbowArrow(arrow) || arrow.isDeleted || arrow.locked ||
        arrow.groupIds.length || !!arrow.frameId || arrow.angle !== 0 ||
        arrow.points.length < 4 || arrow.points.length > 128 ||
        !arrow.points.every(finite) || !validateElbowPoints(arrow.points) ||
        !Array.isArray(arrow.fixedSegments ?? []) ||
        (arrow.fixedSegments ?? []).some((segment) =>
          !Number.isInteger(segment.index) || segment.index <= 1 ||
          segment.index >= arrow.points.length - 1 ||
          !finite(segment.start) || !finite(segment.end)
        )) continue;

    const bindings = [
      ["start", arrow.startBinding],
      ["end", arrow.endBinding],
    ] as const;
    const targets = new Set<string>();
    const missing: MissingOrbit[] = [];
    let valid = true;
    for (const [end, binding] of bindings) {
      if (!binding) continue;
      if (
        binding.mode !== "orbit" ||
        !Array.isArray(binding.fixedPoint) ||
        !finite(binding.fixedPoint) ||
        targets.has(binding.elementId)
      ) {
        valid = false;
        break;
      }
      targets.add(binding.elementId);
      const box = byId.get(binding.elementId);
      if (
        !box || !shape(box) || box.isDeleted || box.locked ||
        box.groupIds.length || !!box.frameId ||
        box.width < 8 || box.height < 8 ||
        ![box.x, box.y, box.width, box.height].every(Number.isFinite)
      ) {
        valid = false;
        break;
      }
      const refs = box.boundElements ?? [];
      if (
        new Set(refs.map((ref) => ref.id)).size !== refs.length ||
        refs.some((ref) =>
          ref.id === arrow.id && ref.type !== "arrow"
        ) ||
        refs.some((ref) => {
          const other = byId.get(ref.id);
          return !other || other.isDeleted ||
            (ref.type === "arrow"
              ? other.type !== "arrow" ||
                !(other.startBinding?.elementId === box.id ||
                  other.endBinding?.elementId === box.id)
              : other.type !== "text" || other.containerId !== box.id);
        })
      ) {
        valid = false;
        break;
      }
      if (!refs.some((ref) => ref.id === arrow.id && ref.type === "arrow")) {
        missing.push({ arrowId: arrow.id, boxId: box.id, end });
      }
    }
    if (
      !valid || !missing.length ||
      // A foreign reverse reference elsewhere is not a missing-link case.
      scene.elements.some((other) => !other.isDeleted && other.id !== arrow.id &&
        other.boundElements?.some((ref) =>
          ref.id === arrow.id && !targets.has(other.id)))
    ) continue;
    output.push(...missing);
  }
  return output;
};

/**
 * Repair only the precise missing reverse references, using Excalidraw's
 * bindBindingElement and arrow rerouting. One isolated core transaction;
 * no source mutation and no unrelated element changes.
 */
export const repairNativeImportedOrbitBindings = (
  scene: SceneFile,
): SceneFile => {
  const missing = missingNativeImportedOrbitBindings(scene);
  if (!missing.length) return scene;
  const affected = new Set(missing.flatMap((r) => [r.arrowId, r.boxId]));
  let next: SceneFile;
  try {
    next = withNativeCoreScene(scene, (core) => {
      for (const entry of missing) {
        const arrow = core.getNonDeletedElement(entry.arrowId);
        const target = core.getNonDeletedElement(entry.boxId);
        if (!arrow || !isElbowArrow(arrow) || !target || !shape(target)) {
          throw new Error("Invalid imported orbit target");
        }
        bindBindingElement(
          arrow as NonDeleted<ExcalidrawElbowArrowElement>,
          target as NonDeleted<ExcalidrawBindableElement>,
          "orbit", entry.end, core,
          { value: 1 } as AppState["zoom"],
        );
        core.mutateElement(
          arrow, { points: [...arrow.points] }, { isBindingEnabled: false },
        );
      }
    });
  } catch {
    return scene;
  }
  if (next === scene) return scene;
  for (let i = 0; i < scene.elements.length; i++) {
    const before = scene.elements[i];
    const after = next.elements[i];
    if (!after || before.id !== after.id ||
        (!affected.has(before.id) && before !== after)) return scene;
    if (!affected.has(before.id)) continue;
    if (
      before.type !== after.type ||
      before.isDeleted !== after.isDeleted ||
      before.frameId !== after.frameId ||
      before.index !== after.index ||
      JSON.stringify(before.groupIds) !== JSON.stringify(after.groupIds)
    ) return scene;
    if (before.type === "arrow") {
      if (after.type !== "arrow" ||
          before.startBinding?.elementId !== after.startBinding?.elementId ||
          before.endBinding?.elementId !== after.endBinding?.elementId ||
          before.startBinding?.mode !== after.startBinding?.mode ||
          before.endBinding?.mode !== after.endBinding?.mode ||
          !nativeEditableComplexElbow(next, after.id)) return scene;
    }
  }
  return missing.every((entry) => next.elements.find((el) =>
    el.id === entry.boxId)?.boundElements?.some((ref) =>
      ref.id === entry.arrowId && ref.type === "arrow"
    )) ? next : scene;
};
