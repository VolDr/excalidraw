import {
  getBoundTextMaxHeight,
  getBoundTextMaxWidth,
  resizeMultipleElements,
  transformElements,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElementWithContainer,
  ElementsMap,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { hasClosedNativeSimpleLinks, safeGroupMembers } from "./groups";
import { nativeReciprocalCaption } from "./boundText";
import { withNativeCoreScene } from "./coreAdapter";
import { isTwoPointArrow, validBinding } from "./bindings";

import type { Handle } from "./transforms";
import type { Point, SceneFile } from "./scene";
import type { Bounds } from "./selection";

type ClosedGroup = {
  roots: ExcalidrawElement[];
  members: ExcalidrawElement[];
  groupId: string;
};

const boxType = (element: ExcalidrawElement) =>
  element.type === "rectangle" ||
  element.type === "ellipse" ||
  element.type === "diamond";

/**
 * The original Excalidraw resize/rotation logic already operates on all
 * simultaneously selected arrows and boxes. Allow it only for a *closed*
 * native group: every forward and reciprocal reference stays inside and the
 * full ancestry/label structure is validated by the existing group guard.
 *
 * Imported elbows, zero-size paths and external bindings must remain
 * read-only until their original transform lifecycle is supported.
 */
const closedGroup = (
  scene: SceneFile,
  ids: readonly string[],
  requireZeroAngle: boolean,
): ClosedGroup | null => {
  const unique = new Set(ids);
  if (ids.length < 3 || unique.size !== ids.length) return null;
  const roots = scene.elements.filter((element) => unique.has(element.id));
  const groupId = roots[0]?.groupIds.at(-1);
  if (
    !groupId ||
    roots.length !== unique.size ||
    roots.some((element) =>
      element.isDeleted ||
      element.locked ||
      !!element.frameId ||
      element.groupIds.at(-1) !== groupId ||
      (requireZeroAngle && element.angle !== 0) ||
      ![element.x, element.y, element.width, element.height, element.angle]
        .every(Number.isFinite) ||
      element.width <= 0 ||
      element.height <= 0
    )
  ) return null;

  const members = safeGroupMembers(scene, groupId);
  if (
    !members.length ||
    !hasClosedNativeSimpleLinks(scene, members) ||
    members.filter((element) =>
      !(element.type === "text" && element.containerId)
    ).some((element) => !unique.has(element.id)) ||
    roots.some((element) => {
      if (boxType(element)) return false;
      return !isTwoPointArrow(element, true) ||
        (!element.startBinding && !element.endBinding) ||
        !validBinding(element.startBinding) ||
        !validBinding(element.endBinding) ||
        element.points.length !== 2 ||
        element.points.some((point) =>
          point.length !== 2 || point.some((n) => !Number.isFinite(n))
        );
    })
  ) return null;
  return { groupId, roots, members };
};

const sameJSON = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Do not adopt any transformation that changes graph identity or metadata. */
const acceptClosedGroup = (
  source: SceneFile,
  next: SceneFile,
  before: ClosedGroup,
): SceneFile => {
  if (next === source ||
    !safeGroupMembers(next, before.groupId).length) return source;
  const newMembers = safeGroupMembers(next, before.groupId);
  if (
    newMembers.length !== before.members.length ||
    !hasClosedNativeSimpleLinks(next, newMembers)
  ) return source;

  const memberIds = new Set(before.members.map((element) => element.id));
  for (let i = 0; i < source.elements.length; i++) {
    const old = source.elements[i];
    const el = next.elements[i];
    if (!el || old.id !== el.id) return source;
    if (!memberIds.has(old.id)) {
      if (el !== old) return source;
      continue;
    }
    if (
      el.type !== old.type ||
      el.isDeleted !== old.isDeleted ||
      el.locked !== old.locked ||
      el.frameId !== old.frameId ||
      !sameJSON(el.groupIds, old.groupIds) ||
      !sameJSON(el.boundElements, old.boundElements) ||
      el.index !== old.index ||
      ![el.x, el.y, el.width, el.height, el.angle].every(Number.isFinite) ||
      el.width <= 0 ||
      el.height <= 0
    ) return source;

    if (old.type === "arrow") {
      if (
        el.type !== "arrow" ||
        !sameJSON(el.startBinding, old.startBinding) ||
        !sameJSON(el.endBinding, old.endBinding) ||
        !sameJSON(el.customData, old.customData) ||
        el.points.length !== old.points.length ||
        el.points.some((p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)))
      ) return source;
    }
    if (old.type === "text") {
      if (
        el.type !== "text" ||
        el.containerId !== old.containerId ||
        el.originalText !== old.originalText ||
        el.textAlign !== old.textAlign ||
        !nativeReciprocalCaption(next, el) ||
        el.width > getBoundTextMaxWidth(
          next.elements.find((item) => item.id === el.containerId)!,
          el,
        ) + 1 ||
        el.height > getBoundTextMaxHeight(
          next.elements.find((item) => item.id === el.containerId)!,
          el as ExcalidrawTextElementWithContainer,
        ) + 1
      ) return source;
    }
  }
  return next;
};

export const transformClosedLinkedGroupWithCore = (
  scene: SceneFile,
  ids: readonly string[],
  handle: Handle,
  point: Point,
  scale: number,
  bounds: Bounds,
): SceneFile => {
  const group = closedGroup(scene, ids, handle !== "rotate");
  if (
    !group ||
    ![point.x, point.y, scale, bounds.x, bounds.y, bounds.width, bounds.height]
      .every(Number.isFinite) ||
    scale <= 0 ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) return scene;

  const next = withNativeCoreScene(scene, (core) => {
    const all = core.getNonDeletedElements();
    const originals = new Map(
      all.map((element) => [element.id, structuredClone(element)]),
    ) as ElementsMap;
    const selected = ids.map((id) => core.getNonDeletedElement(id));
    if (selected.some((element) => !element)) return;
    const roots = selected as NonDeletedExcalidrawElement[];
    if (handle === "rotate") {
      transformElements(
        originals,
        "rotation",
        roots,
        core,
        false,
        false,
        true,
        point.x,
        point.y,
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
    } else {
      resizeMultipleElements(
        roots,
        core.getNonDeletedElementsMap(),
        handle,
        core,
        originals,
        {
          shouldMaintainAspectRatio: true,
          shouldResizeFromCenter: false,
          flipByX: false,
          flipByY: false,
          nextWidth: bounds.width * scale,
          nextHeight: bounds.height * scale,
          originalBoundingBox: {
            minX: bounds.x,
            minY: bounds.y,
            maxX: bounds.x + bounds.width,
            maxY: bounds.y + bounds.height,
            midX: bounds.x + bounds.width / 2,
            midY: bounds.y + bounds.height / 2,
            width: bounds.width,
            height: bounds.height,
          },
        },
      );
    }
  });
  return acceptClosedGroup(scene, next, group);
};
