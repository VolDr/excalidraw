import { describe, expect, it } from "vitest";

import {
  appendNativeArrow,
  isNativeLinkedArrow,
  isSafeBoundBox,
  nativeLinkedEndpoints,
  reconnectNativeEndpoint,
  syncNativeBindings,
} from "./bindings";
import { blankScene, createShape, parseScene, serializeScene } from "./scene";
import {
  deleteSelection,
  moveSelection,
  transformSelected,
} from "./transforms";
import { duplicateSelection } from "./selection";

const makeScene = () => {
  const left = createShape("rectangle", { x: 10, y: 10 }, { x: 110, y: 110 });
  const right = createShape("ellipse", { x: 200, y: 10 }, { x: 300, y: 110 });
  const arrow = createShape("arrow", { x: 110, y: 60 }, { x: 200, y: 60 });
  const scene = appendNativeArrow(
    { ...blankScene(), elements: [left, right] },
    arrow,
    { x: 110, y: 60 },
    { x: 200, y: 60 },
  );
  return { left, right, arrow, scene };
};

describe("native reciprocal arrow binding", () => {
  it("refuses to duplicate linked targets without duplicating their arrows", () => {
    const { left, scene } = makeScene();
    const duplicate = duplicateSelection(scene, [left.id]);
    expect(duplicate.scene).toBe(scene);
    expect(duplicate.ids).toEqual([]);
  });

  it("does not partially duplicate a selection containing a linked target", () => {
    const { left, scene } = makeScene();
    const safe = createShape("diamond", { x: 360, y: 25 }, { x: 460, y: 125 });
    const withSafe = { ...scene, elements: [...scene.elements, safe] };
    const duplicate = duplicateSelection(withSafe, [left.id, safe.id]);
    expect(duplicate.scene).toBe(withSafe);
    expect(duplicate.ids).toEqual([]);
    expect(withSafe.elements).toHaveLength(4);
    expect(duplicateSelection(withSafe, [safe.id]).ids).toHaveLength(1);
  });

  it("deletes linked shapes and arrows without dangling reciprocal bindings", () => {
    const { left, right, arrow, scene } = makeScene();
    const removedBox = deleteSelection(scene, [left.id]);
    const remainingArrow = removedBox.elements[2];
    expect(removedBox.elements[0].isDeleted).toBe(true);
    if (remainingArrow.type !== "arrow") {
      return;
    }
    expect(remainingArrow.startBinding).toBeNull();
    expect(remainingArrow.endBinding?.elementId).toBe(right.id);
    expect(removedBox.elements[1].boundElements?.[0].id).toBe(arrow.id);
    expect(isNativeLinkedArrow(removedBox, remainingArrow)).toBe(true);
    const removedArrow = deleteSelection(scene, [arrow.id]);
    expect(removedArrow.elements[2].isDeleted).toBe(true);
    expect(removedArrow.elements[0].boundElements).toBeNull();
    expect(removedArrow.elements[1].boundElements).toBeNull();
    expect(scene.elements[0].isDeleted).toBe(false);
  });

  it("links both ends on creation and round-trips official Excalidraw metadata", () => {
    const { left, right, arrow, scene } = makeScene();
    const linked = scene.elements[2];
    expect(linked.type).toBe("arrow");
    if (linked.type !== "arrow") {
      return;
    }
    expect(linked.startBinding).toEqual({
      elementId: left.id,
      fixedPoint: [1, 0.5001],
      mode: "inside",
    });
    expect(linked.endBinding).toEqual({
      elementId: right.id,
      fixedPoint: [0, 0.5001],
      mode: "inside",
    });
    expect(scene.elements[0].boundElements).toEqual([
      { id: arrow.id, type: "arrow" },
    ]);
    expect(scene.elements[1].boundElements).toEqual([
      { id: arrow.id, type: "arrow" },
    ]);
    expect(isNativeLinkedArrow(scene, linked)).toBe(true);
    expect(isSafeBoundBox(scene, scene.elements[0])).toBe(true);
    const restored = parseScene(serializeScene(scene));
    expect(restored).toEqual(scene);
    const anchor = nativeLinkedEndpoints(restored, restored.elements[2]);
    expect(anchor?.start.x).toBeCloseTo(110);
    expect(anchor?.start.y).toBeCloseTo(60, 1);
    expect(anchor?.end.x).toBeCloseTo(200);
    expect(anchor?.end.y).toBeCloseTo(60, 1);
    expect(syncNativeBindings(restored)).toBe(restored);
  });

  it("keeps endpoints attached on move, resize and rotation, in one scene transaction", () => {
    const { left, scene } = makeScene();
    const moved = moveSelection(scene, [left.id], 30, 15);
    expect(moved.elements[0].x).toBe(40);
    const movedAnchors = nativeLinkedEndpoints(moved, moved.elements[2]);
    expect(movedAnchors?.start.x).toBeCloseTo(140);
    expect(movedAnchors?.start.y).toBeCloseTo(75, 1);
    expect(movedAnchors?.end.x).toBeCloseTo(200);
    expect(movedAnchors?.end.y).toBeCloseTo(60, 1);
    expect(scene.elements[0].x).toBe(10);
    const resized = transformSelected(moved, left.id, "se", { x: 180, y: 160 });
    const box = resized.elements[0];
    const points = nativeLinkedEndpoints(resized, resized.elements[2]);
    expect(points?.start.x).toBeCloseTo(box.x + box.width);
    expect(points?.start.y).toBeCloseTo(box.y + box.height / 2, 1);
    expect(points?.end?.x).toBeCloseTo(200);
    expect(points?.end?.y).toBeCloseTo(60, 1);
    const center = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };
    const rotated = transformSelected(resized, left.id, "rotate", {
      x: center.x + 50,
      y: center.y,
    });
    const rotatedPoint = nativeLinkedEndpoints(
      rotated,
      rotated.elements[2],
    )!.start;
    expect(rotatedPoint.x).toBeCloseTo(center.x, 1);
    expect(rotatedPoint.y).toBeCloseTo(center.y + box.width / 2, 1);
  });

  it("unhooks old target and reattaches to new target without stale reverse references", () => {
    const { left, right, arrow, scene } = makeScene();
    const detached = reconnectNativeEndpoint(scene, arrow.id, "end", {
      x: 380,
      y: 180,
    });
    const el = detached.elements[2];
    if (el.type !== "arrow") {
      return;
    }
    expect(el.startBinding?.elementId).toBe(left.id);
    expect(el.endBinding).toBeNull();
    expect(detached.elements[1].boundElements).toBeNull();
    expect(detached.elements[0].boundElements?.[0].id).toBe(arrow.id);
    expect(nativeLinkedEndpoints(detached, el)?.end).toEqual({
      x: 380,
      y: 180,
    });
    const reconnected = reconnectNativeEndpoint(detached, arrow.id, "end", {
      x: right.x + 50,
      y: right.y + 50,
    });
    const linked = reconnected.elements[2];
    expect(isNativeLinkedArrow(reconnected, linked)).toBe(true);
    expect(reconnected.elements[1].boundElements?.[0].id).toBe(arrow.id);
    expect(reconnected.elements[0].boundElements?.[0].id).toBe(arrow.id);
  });

  it("leaves imported complex/orbit arrow bindings untouched", () => {
    const { left, arrow, scene } = makeScene();
    const imported = {
      ...scene,
      elements: scene.elements.map((element) =>
        element.id === arrow.id && element.type === "arrow"
          ? {
              ...element,
              startBinding: element.startBinding && {
                ...element.startBinding,
                mode: "orbit" as const,
              },
            }
          : element,
      ),
    };
    expect(isSafeBoundBox(imported, imported.elements[0])).toBe(false);
    expect(isNativeLinkedArrow(imported, imported.elements[2])).toBe(false);
    expect(moveSelection(imported, [left.id], 10, 10)).toBe(imported);
    expect(syncNativeBindings(imported)).toBe(imported);
    expect(
      transformSelected(imported, left.id, "se", { x: 300, y: 300 })
        .elements[0],
    ).toBe(imported.elements[0]);
  });

  it("avoids circular self-links and does not mutate unbound arrows", () => {
    const rectangle = createShape(
      "rectangle",
      { x: 10, y: 10 },
      { x: 110, y: 110 },
    );
    const arrow = createShape("arrow", { x: 20, y: 30 }, { x: 90, y: 80 });
    const result = appendNativeArrow(
      { ...blankScene(), elements: [rectangle] },
      arrow,
      { x: 20, y: 30 },
      { x: 90, y: 80 },
    );
    const linked = result.elements[1];
    if (linked.type !== "arrow") {
      return;
    }
    expect(linked.startBinding?.elementId).toBe(rectangle.id);
    expect(linked.endBinding).toBeNull();
    expect(result.elements[0].boundElements).toHaveLength(1);
    expect(syncNativeBindings(result)).toBe(result);
  });
});
