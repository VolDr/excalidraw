import { bindBindingElement } from "@excalidraw/element";

import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  NonDeleted,
  ExcalidrawBindableElement,
} from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { isNativeLinkedArrow, isTwoPointArrow, validBinding } from "./bindings";
import { nativeReciprocalCaption } from "./boundText";
import { withNativeCoreScene } from "./coreAdapter";

import type { SceneFile } from "./scene";

type MissingBinding = {
  arrowId: string;
  boxId: string;
  end: "start" | "end";
};

const shape = (item: ExcalidrawElement) =>
  item.type === "rectangle" ||
  item.type === "ellipse" ||
  item.type === "diamond";

/**
 * Some imported Excalidraw files contain a valid arrow.startBinding/
 * endBinding, while the box's boundElements list lacks the reciprocal
 * arrow record. Do not silently rewrite these imports: identify only the
 * simple inside-binding cases that can be restored by the original
 * bindBindingElement lifecycle.
 *
 * Reject grouped/framed/elbowed arrows, unknown modes/targets, duplicated
 * reverse references and any malformed caption dependency.
 */
export const missingNativeImportedBindings = (
  scene: SceneFile,
): MissingBinding[] => {
  const byId = new Map(scene.elements.map((element) => [element.id, element]));
  const missing: MissingBinding[] = [];
  for (const element of scene.elements) {
    if (
      !isTwoPointArrow(element) ||
      !validBinding(element.startBinding) ||
      !validBinding(element.endBinding) ||
      ![element.x, element.y, element.width, element.height, element.angle]
        .every(Number.isFinite) ||
      !element.startBinding && !element.endBinding
    ) continue;
    const bindings = [
      ["start", element.startBinding],
      ["end", element.endBinding],
    ] as const;
    const targets = new Set(
      bindings.map(([, binding]) => binding?.elementId).filter(Boolean),
    );
    if (targets.size !== bindings.filter(([, binding]) => binding).length) {
      continue;
    }
    const queued: MissingBinding[] = [];
    let compatible = true;
    for (const [end, binding] of bindings) {
      if (!binding) continue;
      const target = byId.get(binding.elementId);
      if (
        !target ||
        !shape(target) ||
        target.isDeleted ||
        target.locked ||
        !!target.frameId ||
        target.groupIds.length > 0 ||
        ![target.x, target.y, target.width, target.height, target.angle]
          .every(Number.isFinite) ||
        target.width < 8 ||
        target.height < 8
      ) {
        compatible = false;
        break;
      }
      const refs = target.boundElements ?? [];
      if (
        new Set(refs.map((ref) => ref.id)).size !== refs.length ||
        refs.some((ref) => ref.id === element.id && ref.type !== "arrow") ||
        refs.some((ref) =>
          ref.type === "text" &&
          !nativeReciprocalCaption(
            scene,
            byId.get(ref.id) ?? ({} as ExcalidrawElement),
          )
        )
      ) {
        compatible = false;
        break;
      }
      if (!refs.some((ref) => ref.id === element.id && ref.type === "arrow")) {
        queued.push({ arrowId: element.id, boxId: target.id, end });
      }
    }
    if (compatible && queued.length) missing.push(...queued);
  }
  return missing;
};

/**
 * Explicit, undoable import repair. The original core API both recalculates
 * the fixedPoint and adds each missing reverse boundElements record. Adopt
 * the transaction only if all repaired arrows become fully reciprocal,
 * no unrelated objects change and the source scene is untouched.
 */
export const repairNativeImportedBindings = (scene: SceneFile): SceneFile => {
  const missing = missingNativeImportedBindings(scene);
  if (!missing.length) return scene;
  const affected = new Set(
    missing.flatMap((entry) => [entry.arrowId, entry.boxId]),
  );
  const repaired = withNativeCoreScene(scene, (core) => {
    for (const { arrowId, boxId, end } of missing) {
      const arrow = core.getNonDeletedElement(arrowId);
      const target = core.getNonDeletedElement(boxId);
      if (!arrow || !target || arrow.type !== "arrow" || !shape(target)) {
        throw new Error("Binding changed while importing");
      }
      bindBindingElement(
        arrow as NonDeleted<ExcalidrawArrowElement>,
        target as NonDeleted<ExcalidrawBindableElement>,
        "inside",
        end,
        core,
        { value: 1 } as AppState["zoom"],
      );
    }
  });
  if (repaired === scene) return scene;

  const oldById = new Map(scene.elements.map((element) => [element.id, element]));
  for (let i = 0; i < repaired.elements.length; i++) {
    const after = repaired.elements[i];
    const before = scene.elements[i];
    if (!before || before.id !== after.id) return scene;
    if (!affected.has(before.id)) {
      if (after !== before) return scene;
      continue;
    }
    if (
      before.type !== after.type ||
      before.isDeleted !== after.isDeleted ||
      before.index !== after.index ||
      JSON.stringify(before.groupIds) !== JSON.stringify(after.groupIds) ||
      before.x !== after.x || before.y !== after.y ||
      before.width !== after.width || before.height !== after.height ||
      before.angle !== after.angle
    ) return scene;
    if (before.type === "arrow") {
      if (after.type !== "arrow" ||
        JSON.stringify(after.points) !== JSON.stringify(before.points) ||
        !isNativeLinkedArrow(repaired, after)) return scene;
      for (const side of ["startBinding", "endBinding"] as const) {
        const old = before[side];
        const next = after[side];
        if (old?.elementId !== next?.elementId ||
            old?.mode !== next?.mode ||
            !validBinding(next)) return scene;
      }
    }
  }
  // All changed box references must point to arrows that actually reference
  // those boxes; the original core owns updating both sides.
  for (const { boxId, arrowId } of missing) {
    const box = repaired.elements.find((item) => item.id === boxId);
    const arrow = repaired.elements.find((item) => item.id === arrowId);
    if (
      !box ||
      !arrow ||
      arrow.type !== "arrow" ||
      !box.boundElements?.some((ref) =>
        ref.type === "arrow" && ref.id === arrowId
      ) ||
      !isNativeLinkedArrow(repaired, arrow)
    ) return scene;
  }
  return repaired;
};
