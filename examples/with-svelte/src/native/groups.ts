import type { ExcalidrawElement } from "@excalidraw/element/types";

import { isSafeBoundBox, isNativeLinkedArrow } from "./bindings";
import { nativeEditableLabel, nativeLabelBox } from "./boundText";
import { nativeImageSource } from "./images";
import { isNativeShape } from "./scene";

import type { SceneFile } from "./scene";

/**
 * The native editor supports flat groups with independent elements and
 * reciprocal box/text pairs. Bound labels are internal group members, never
 * separate selection roots. Foreign and nested groups remain read-only.
 */
const isIndependent = (element: ExcalidrawElement): boolean => {
  if (
    !isNativeShape(element) ||
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
    if (
      element.type === "rectangle" ||
      element.type === "ellipse" ||
      element.type === "diamond"
    ) {
      // An orphan may still point at this apparently unbound box.
      return !scene.elements.some(
        (label) =>
          label.type === "text" &&
          !label.isDeleted &&
          label.containerId === element.id,
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

/** Validate the *entire* flat group before permitting any mutation. */
export function safeGroupMembers(
  scene: SceneFile,
  id: string,
): ExcalidrawElement[] {
  const members = scene.elements.filter((element) =>
    element.groupIds.includes(id),
  );
  const ids = new Set(members.map((element) => element.id));
  if (
    members.length < 2 ||
    members.some(
      (element) =>
        element.groupIds.length !== 1 ||
        element.groupIds[0] !== id ||
        element.locked ||
        element.frameId ||
        element.isDeleted,
    )
  ) {
    return [];
  }

  for (const element of members) {
    if (isBoundLabel(element)) {
      const box = nativeLabelBox(scene, element);
      if (!box || !ids.has(box.id)) {
        return [];
      }
    } else if (!isSupportedRoot(scene, element)) {
      return [];
    } else {
      const label = nativeEditableLabel(scene, element);
      if (label && !ids.has(label.id)) {
        return [];
      }
    }
  }
  // A box plus its own label is still one logical item, not a group.
  return selectionRoots(members).length >= 2 ? members : [];
}

/** Hit-testing a group returns selectable roots, not internal labels. */
export function selectionUnit(scene: SceneFile, id: string): string[] {
  const element = scene.elements.find((item) => item.id === id);
  if (!element) {
    return [];
  }
  if (element.groupIds.length) {
    return element.groupIds.length === 1
      ? selectionRoots(safeGroupMembers(scene, element.groupIds[0])).map(
          (item) => item.id,
        )
      : [];
  }
  if (
    isNativeLinkedArrow(scene, element) ||
    (isSafeBoundBox(scene, element) && !!element.boundElements?.length)
  ) {
    return [id];
  }
  return isIndependent(element) ? [id] : [];
}

/** Accept only whole groups and roots of valid reciprocal label pairs. */
export function editableSelection(
  scene: SceneFile,
  ids: readonly string[],
): string[] {
  const selected = new Set(ids);
  const allowedGroups = new Set<string>();
  for (const element of scene.elements) {
    if (selected.has(element.id) && element.groupIds.length === 1) {
      const groupId = element.groupIds[0];
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
        (canEditIndependently(element) ||
          (isSafeBoundBox(scene, element) && !!element.boundElements?.length) ||
          (element.groupIds.length === 1 &&
            allowedGroups.has(element.groupIds[0]))),
    )
    .map((element) => element.id);
}

const touch = <T extends ExcalidrawElement>(
  element: T,
  change: Partial<T>,
): T => ({
  ...element,
  ...change,
  version: element.version + 1,
  versionNonce: Math.floor(Math.random() * 2 ** 31),
  updated: Date.now(),
});

/** Group two or more roots, including each bound label as an atomic member. */
export function groupSelection(
  scene: SceneFile,
  ids: readonly string[],
): { scene: SceneFile; ids: string[]; groupId: string | null } {
  const selected = new Set(ids);
  const roots = scene.elements.filter((element) => selected.has(element.id));
  if (
    roots.length < 2 ||
    roots.some(
      (element) =>
        element.groupIds.length !== 0 ||
        !isSupportedRoot(scene, element),
    )
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
          ? touch(element, { groupIds: [groupId] })
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
        (element) => selected.has(element.id) && element.groupIds.length === 1,
      )
      .map((element) => element.groupIds[0]),
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
      element.groupIds.length === 1 && allowed.has(element.groupIds[0]),
  );
  return {
    scene: {
      ...scene,
      elements: scene.elements.map((element) =>
        affected.includes(element) ? touch(element, { groupIds: [] }) : element,
      ),
    },
    ids: selectionRoots(affected).map((element) => element.id),
  };
}
