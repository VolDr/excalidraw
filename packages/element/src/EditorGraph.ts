import { validateElbowPoints } from "./elbowArrow";
import type { ExcalidrawElement } from "./types";

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

const finite = (element: ExcalidrawElement): boolean =>
  [element.x, element.y, element.width, element.height, element.angle]
    .every(Number.isFinite) &&
  (element.type !== "arrow" && element.type !== "line" ||
    element.points.every((point) =>
      point.length === 2 && point.every(Number.isFinite)
    ));

/**
 * Existing imported files can have missing reciprocal references. React
 * normally attempts to restore these during import. Preserve any existing
 * anomalies but never introduce NEW broken references as a side effect of
 * a native edit. This is a graph invariant, not a per-tool whitelist.
 */
export const getCoreGraphDefects = (
  elements: readonly ExcalidrawElement[],
): ReadonlySet<string> => {
  const defects = new Set<string>();
  const byId = new Map(elements.filter((el) => !el.isDeleted)
    .map((el) => [el.id, el]));

  for (const element of byId.values()) {
    if (element.frameId) {
      const frame = byId.get(element.frameId);
      if (!frame || (frame.type !== "frame" && frame.type !== "magicframe")) {
        defects.add(`frame:${element.id}:${element.frameId}`);
      }
    }
    if (element.type === "arrow") {
      for (const end of ["start", "end"] as const) {
        const binding = element[end === "start" ? "startBinding" : "endBinding"];
        if (!binding) continue;
        const target = byId.get(binding.elementId);
        if (
          !target ||
          !target.boundElements?.some((ref) =>
            ref.type === "arrow" && ref.id === element.id
          )
        ) {
          defects.add(`arrow:${element.id}:${end}:${binding.elementId}`);
        }
      }
    }
    if (element.type === "text" && element.containerId) {
      const owner = byId.get(element.containerId);
      if (!owner?.boundElements?.some((ref) =>
        ref.type === "text" && ref.id === element.id
      )) {
        defects.add(`caption:${element.id}:${element.containerId}`);
      }
    }
    const refIds = new Set<string>();
    for (const ref of element.boundElements ?? []) {
      if (refIds.has(ref.id)) {
        defects.add(`duplicate:${element.id}:${ref.id}`);
      }
      refIds.add(ref.id);
      const target = byId.get(ref.id);
      if (ref.type === "arrow" && (
        target?.type !== "arrow" ||
        target.startBinding?.elementId !== element.id &&
        target.endBinding?.elementId !== element.id
      )) {
        defects.add(`reverse-arrow:${element.id}:${ref.id}`);
      } else if (ref.type === "text" && (
        target?.type !== "text" ||
        target.containerId !== element.id
      )) {
        defects.add(`reverse-text:${element.id}:${ref.id}`);
      }
    }
  }
  return defects;
};

/**
 * Accept an original Excalidraw core operation, including graphs imported
 * with elbows, frames and unusual bindings, if it retains element identity,
 * does not change immutable grouping metadata and does not worsen any
 * reciprocal-reference defects already present in the source file.
 *
 * No arrow/shape type is specially authorized or prohibited here.
 */
export const isCoreGraphTransitionValid = (
  before: readonly ExcalidrawElement[],
  after: readonly ExcalidrawElement[],
): boolean => {
  if (before.length !== after.length) return false;
  const prior = getCoreGraphDefects(before);
  const result = getCoreGraphDefects(after);
  if ([...result].some((defect) => !prior.has(defect))) return false;

  for (let i = 0; i < before.length; i++) {
    const old = before[i];
    const updated = after[i];
    if (!updated || old.id !== updated.id ||
        old.type !== updated.type ||
        old.index !== updated.index ||
        old.isDeleted !== updated.isDeleted ||
        old.locked !== updated.locked ||
        old.frameId !== updated.frameId ||
        !same(old.groupIds, updated.groupIds) ||
        !same(old.customData, updated.customData)) return false;
    if (same(old, updated)) continue;
    if (!finite(updated)) return false;
    if (
      old.type === "arrow" && updated.type === "arrow" &&
      old.elbowed && updated.elbowed &&
      validateElbowPoints(old.points) &&
      !validateElbowPoints(updated.points)
    ) return false;
  }
  return true;
};
