import {
  addToGroup,
  getElementsInGroup,
  removeFromSelectedGroups,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  isSafeBoundBox,
  isNativeLinkedArrow,
  isNativeOrbitLinkedArrow,
  isTwoPointArrow,
  validBinding,
} from "./bindings";
import { updateNativeElement } from "./coreAdapter";
import { nativeEditableLabel, nativeLabelBox, nativeReciprocalCaption } from "./boundText";
import { nativeImageSource } from "./images";
import { isNativeShape } from "./scene";
import { isSafeNativeFrameChild } from "./frameMove";

import type { SceneFile } from "./scene";

/**
 * Native groups use Excalidraw's original groupIds ancestry order:
 * innermost ID first, outermost ID last. The Svelte UI always selects an
 * entire top-level group, not an arbitrary nested sub-selection. This keeps
 * the original Scene drag/binding algorithms in control of actual movement.
 *
 * Imported group ancestry, captions and external dependencies are validated
 * before any native group mutation. Unsupported graphs remain untouched.
 */
const isIndependent = (element: ExcalidrawElement): boolean => {
  if (
    !isNativeShape(element) ||
    element.isDeleted ||
    element.locked ||
    element.frameId ||
    element.boundElements?.length
  ) {
    return false;
  }
  if (element.type === "line" || element.type === "arrow") {
    return !element.startBinding && !element.endBinding;
  }
  return element.type !== "text" || element.containerId === null;
};

const isSupportedRoot = (
  scene: SceneFile,
  element: ExcalidrawElement,
): boolean => {
  if (
    element.type === "image" &&
    !nativeImageSource(scene, element)
  ) {
    return false;
  }
  if (isIndependent(element)) {
    // An imported element may be referenced by a different element while its
    // own binding fields are missing. Never mutate half of such a relation.
    if (
      scene.elements.some(
        (other) =>
          !other.isDeleted &&
          other.id !== element.id &&
          other.boundElements?.some((ref) => ref.id === element.id),
      )
    ) {
      return false;
    }
    if (
      element.type === "rectangle" ||
      element.type === "ellipse" ||
      element.type === "diamond"
    ) {
      // An orphan may still point at this apparently unbound box.
      return !scene.elements.some(
        (dependent) =>
          !dependent.isDeleted &&
          ((dependent.type === "text" &&
            dependent.containerId === element.id) ||
            (dependent.type === "arrow" &&
              (dependent.startBinding?.elementId === element.id ||
                dependent.endBinding?.elementId === element.id))),
      );
    }
    return true;
  }
  return nativeEditableLabel(scene, element) != null;
};

const isBoundLabel = (element: ExcalidrawElement): boolean =>
  element.type === "text" && element.containerId !== null;

const selectionRoots = (members: readonly ExcalidrawElement[]) =>
  members.filter((element) => !isBoundLabel(element));

export const canEditIndependently = (element: ExcalidrawElement): boolean =>
  isIndependent(element) && element.groupIds.length === 0;

/**
 * A composite box can own one reciprocal caption plus arrow references.
 * The standard nativeLabelBox path remains strictly single-label-only:
 * here we only verify that the original core may move/copy the entire closed
 * group without detaching any of its internal relationships.
 */
const isClosedGraphCaption = (
  scene: SceneFile,
  memberMap: ReadonlyMap<string, ExcalidrawElement>,
  label: ExcalidrawElement,
): boolean => {
  const box = nativeReciprocalCaption(scene, label);
  return !!box && memberMap.has(box.id);
};

/**
 * Recognize a *closed* ordinary-arrow binding component. This validator
 * never calculates an endpoint or mutates its binding: all geometry and
 * reciprocity updates remain in Excalidraw's original Scene operations.
 *
 * External references and mixed box-caption-arrow graphs remain guarded.
 */
export function hasClosedNativeSimpleLinks(
  scene: SceneFile,
  members: readonly ExcalidrawElement[],
): boolean {
  const byId = new Map(members.map((element) => [element.id, element]));
  const memberIds = new Set(byId.keys());
  if (!members.some(
    (el) => el.type === "arrow" && !!(el.startBinding || el.endBinding),
  )) {
    return false;
  }

  for (const element of members) {
    if (element.isDeleted || element.locked || element.frameId) {
      return false;
    }
    if (isBoundLabel(element)) {
      if (!isClosedGraphCaption(scene, byId, element)) return false;
      continue;
    }
    if (element.type === "arrow" && (element.startBinding || element.endBinding)) {
      if (
        !isTwoPointArrow(element, true) ||
        !validBinding(element.startBinding) ||
        !validBinding(element.endBinding) ||
        ![element.x, element.y, element.angle, element.width, element.height]
          .every(Number.isFinite) ||
        element.points.some((point) => point.some((value) => !Number.isFinite(value)))
      ) return false;

      const targets = new Set<string>();
      for (const binding of [element.startBinding, element.endBinding]) {
        if (!binding) continue;
        const target = byId.get(binding.elementId);
        if (
          !target ||
          !["rectangle", "ellipse", "diamond"].includes(target.type) ||
          targets.has(target.id) ||
          target.locked ||
          target.isDeleted ||
          !target.boundElements?.some(
            (ref) => ref.type === "arrow" && ref.id === element.id,
          )
        ) return false;
        targets.add(target.id);
      }
      continue;
    }
    if (
      ["rectangle", "ellipse", "diamond"].includes(element.type) &&
      element.boundElements?.some((ref) => ref.type === "arrow")
    ) {
      if (
        element.boundElements.length > 32 ||
        new Set(element.boundElements.map((ref) => ref.id)).size !== element.boundElements.length ||
        element.boundElements.some((ref) => {
          if (ref.type === "text") {
            const label = byId.get(ref.id);
            return !label || !isClosedGraphCaption(scene, byId, label);
          }
          if (ref.type !== "arrow") return true;
          const arrow = byId.get(ref.id);
          return !arrow ||
            arrow.type !== "arrow" ||
            !(arrow.startBinding?.elementId === element.id ||
              arrow.endBinding?.elementId === element.id);
        })
      ) return false;
      continue;
    }
    if (!isSupportedRoot(scene, element)) return false;
  }

  return !scene.elements.some((external) =>
    !external.isDeleted && !memberIds.has(external.id) &&
    (
      (external.type === "arrow" &&
        ((external.startBinding && memberIds.has(external.startBinding.elementId)) ||
          (external.endBinding && memberIds.has(external.endBinding.elementId)))) ||
      (external.type === "text" && external.containerId && memberIds.has(external.containerId)) ||
      external.boundElements?.some((ref) => memberIds.has(ref.id))
    )
  );
}

/**
 * Validate every descendant of a group, including nested groups and the
 * internal labels of selected boxes. An inner group cannot also appear under
 * another parent: all members must agree about that group's outer ancestry.
 *
 * Group cardinality counts logical roots rather than bound labels. We reject
 * singleton inner groups as well as singleton outer groups.
 */
export function safeGroupMembers(
  scene: SceneFile,
  id: string,
): ExcalidrawElement[] {
  const members = getElementsInGroup(scene.elements, id).filter(
    (element) => !element.isDeleted,
  );
  const memberIds = new Set(members.map((element) => element.id));
  const ancestry = new Map<string, string>();
  const rootsByGroup = new Map<string, Set<string>>();
  const closedLinks = hasClosedNativeSimpleLinks(scene, members);
  if (members.length < 2) {
    return [];
  }

  for (const element of members) {
    if (
      element.locked ||
      element.frameId ||
      !element.groupIds.includes(id) ||
      new Set(element.groupIds).size !== element.groupIds.length
    ) {
      return [];
    }

    for (let i = 0; i < element.groupIds.length; i++) {
      const groupId = element.groupIds[i];
      const parents = element.groupIds.slice(i + 1).join("\u0000");
      const known = ancestry.get(groupId);
      if (known !== undefined && known !== parents) {
        return [];
      }
      ancestry.set(groupId, parents);
      if (isBoundLabel(element)) {
        continue;
      }
      const roots = rootsByGroup.get(groupId) ?? new Set<string>();
      roots.add(element.id);
      rootsByGroup.set(groupId, roots);
    }

    if (isBoundLabel(element)) {
      const box = nativeLabelBox(scene, element);
      if ((!box || !memberIds.has(box.id)) &&
          (!closedLinks || !isClosedGraphCaption(
            scene,
            new Map(members.map((member) => [member.id, member])),
            element,
          ))) {
        return [];
      }
    } else if (!isSupportedRoot(scene, element) && !closedLinks) {
      return [];
    } else {
      const label = nativeEditableLabel(scene, element);
      if (label && !memberIds.has(label.id)) {
        return [];
      }
    }
  }

  // A group used by any other active element must have the same ancestry,
  // otherwise an imported half-group would be selected only in part.
  for (const element of scene.elements) {
    if (element.isDeleted) {
      continue;
    }
    for (let i = 0; i < element.groupIds.length; i++) {
      const groupId = element.groupIds[i];
      const parents = ancestry.get(groupId);
      if (
        parents !== undefined &&
        parents !== element.groupIds.slice(i + 1).join("\u0000")
      ) {
        return [];
      }
    }
  }

  return [...rootsByGroup.values()].every((roots) => roots.size >= 2)
    ? members
    : [];
}

/** Hit-testing a group returns selectable roots, not internal labels. */
export function selectionUnit(scene: SceneFile, id: string): string[] {
  const element = scene.elements.find((item) => item.id === id);
  if (!element || element.isDeleted) {
    return [];
  }
  if (element.groupIds.length) {
    const outermost = element.groupIds[element.groupIds.length - 1];
    return selectionRoots(safeGroupMembers(scene, outermost)).map(
      (item) => item.id,
    );
  }
  if (
    isNativeLinkedArrow(scene, element) ||
    isNativeOrbitLinkedArrow(scene, element) ||
    (isSafeBoundBox(scene, element) && !!element.boundElements?.length)
  ) {
    return [id];
  }
  return (
    isSafeNativeFrameChild(scene, element) ||
    isIndependent(element) && isSupportedRoot(scene, element)
  ) ? [id] : [];
}

/** Accept only whole groups and roots of valid reciprocal label pairs. */
export function editableSelection(
  scene: SceneFile,
  ids: readonly string[],
): string[] {
  const selected = new Set(ids);
  const allowedGroups = new Set<string>();
  for (const element of scene.elements) {
    if (selected.has(element.id) && element.groupIds.length) {
      const groupId = element.groupIds[element.groupIds.length - 1];
      const members = safeGroupMembers(scene, groupId);
      if (
        members.length &&
        selectionRoots(members).every((member) => selected.has(member.id))
      ) {
        allowedGroups.add(groupId);
      }
    }
  }
  return scene.elements
    .filter(
      (element) =>
        selected.has(element.id) &&
        !isBoundLabel(element) &&
        ((canEditIndependently(element) && isSupportedRoot(scene, element)) ||
          isSafeNativeFrameChild(scene, element) ||
          (isSafeBoundBox(scene, element) && !!element.boundElements?.length) ||
          (element.groupIds.length > 0 &&
            allowedGroups.has(element.groupIds[element.groupIds.length - 1]))),
    )
    .map((element) => element.id);
}



/** Group two or more roots, including each bound label as an atomic member. */
export function groupSelection(
  scene: SceneFile,
  ids: readonly string[],
): { scene: SceneFile; ids: string[]; groupId: string | null } {
  const selected = new Set(ids);
  const roots = scene.elements.filter((element) => selected.has(element.id));
  const allowed = new Set(editableSelection(scene, ids));
  const candidates = roots.flatMap((element) => {
    const label = nativeEditableLabel(scene, element);
    const refs = element.boundElements?.filter((ref) => ref.type === "text") ?? [];
    const linkedText = refs
      .map((ref) => scene.elements.find((item) =>
        item.id === ref.id &&
        item.type === "text" &&
        item.containerId === element.id,
      ))
      .filter((item): item is ExcalidrawElement => !!item);
    return [element, ...new Map(
      [...(label ? [label] : []), ...linkedText]
        .map((item) => [item.id, item]),
    ).values()];
  });
  const closedLinks = hasClosedNativeSimpleLinks(scene, candidates);
  const units = new Set<string>();
  for (const root of roots) {
    const outermost = root.groupIds[root.groupIds.length - 1];
    units.add(outermost ? `group:${outermost}` : `element:${root.id}`);
  }
  if (
    !roots.length ||
    roots.length !== selected.size ||
    (!closedLinks && allowed.size !== selected.size) ||
    units.size < 2 ||
    roots.some((element) => {
      const outermost = element.groupIds[element.groupIds.length - 1];
      if (outermost) {
        const members = safeGroupMembers(scene, outermost);
        if (!members.length ||
            selectionRoots(members).some((root) => !selected.has(root.id))) {
          return true;
        }
      }
      return !isSupportedRoot(scene, element) && !closedLinks;
    })
  ) {
    return { scene, ids: [], groupId: null };
  }
  const allIds = new Set(candidates.map((element) => element.id));
  const groupId = crypto.randomUUID();
  return {
    scene: {
      ...scene,
      elements: scene.elements.map((element) =>
        allIds.has(element.id)
          ? updateNativeElement(element, {
              groupIds: addToGroup(element.groupIds, groupId, null),
            })
          : element,
      ),
    },
    ids: roots.map((element) => element.id),
    groupId,
  };
}

/** Remove a whole valid native group, including its internal bound labels. */
export function ungroupSelection(
  scene: SceneFile,
  ids: readonly string[],
): { scene: SceneFile; ids: string[] } {
  const selected = new Set(ids);
  const groupIds = new Set(
    scene.elements
      .filter(
        (element) => selected.has(element.id) && element.groupIds.length > 0,
      )
      .map((element) => element.groupIds[element.groupIds.length - 1]),
  );
  const allowed = new Set<string>();
  for (const groupId of groupIds) {
    const members = safeGroupMembers(scene, groupId);
    if (
      members.length &&
      selectionRoots(members).every((element) => selected.has(element.id))
    ) {
      allowed.add(groupId);
    }
  }
  if (!allowed.size) {
    return { scene, ids: [] };
  }
  const affected = scene.elements.filter(
    (element) =>
      element.groupIds.some((groupId) => allowed.has(groupId)),
  );
  const selectedGroupIds = Object.fromEntries(
    [...allowed].map((groupId) => [groupId, true]),
  );
  return {
    scene: {
      ...scene,
      elements: scene.elements.map((element) =>
        affected.includes(element)
          ? updateNativeElement(element, {
              groupIds: removeFromSelectedGroups(
                element.groupIds,
                selectedGroupIds,
              ),
            })
          : element,
      ),
    },
    ids: selectionRoots(affected).map((element) => element.id),
  };
}
