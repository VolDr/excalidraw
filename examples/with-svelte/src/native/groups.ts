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
} from "./bindings";
import { updateNativeElement } from "./coreAdapter";
import { nativeEditableLabel, nativeLabelBox } from "./boundText";
import { nativeImageSource } from "./images";
import { isNativeShape } from "./scene";

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
      if (!box || !memberIds.has(box.id)) {
        return [];
      }
    } else if (!isSupportedRoot(scene, element)) {
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
  return isIndependent(element) && isSupportedRoot(scene, element)
    ? [id]
    : [];
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
  const units = new Set<string>();
  for (const root of roots) {
    const outermost = root.groupIds[root.groupIds.length - 1];
    units.add(outermost ? `group:${outermost}` : `element:${root.id}`);
  }
  if (
    !roots.length ||
    roots.length !== selected.size ||
    allowed.size !== selected.size ||
    units.size < 2 ||
    roots.some((element) => !isSupportedRoot(scene, element))
  ) {
    return { scene, ids: [], groupId: null };
  }
  const allIds = new Set(roots.map((element) => element.id));
  for (const root of roots) {
    const label = nativeEditableLabel(scene, root);
    if (label) {
      allIds.add(label.id);
    }
  }
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
