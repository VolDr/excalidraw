import { describe, expect, it } from "vitest";

import {
  isNativeOrbitLinkedArrow,
  isSafeBoundBox,
  nativeOrbitEndpoints,
  reconnectNativeOrbitEndpoint,
} from "./bindings";
import { convertArrowToElbow } from "./lines";
import { deleteSelection, moveSelection, transformSelected } from "./transforms";
import { SceneHistory } from "./history";
import { blankScene, createShape, parseScene, serializeScene } from "./scene";

/** Two Excalidraw-routed arrows attach to the same validated rectangle. */
const connectedPair = () => {
  const shared = createShape("rectangle", { x: 20, y: 40 }, { x: 150, y: 160 });
  const upper = createShape("arrow", { x: 195, y: 70 }, { x: 400, y: 70 });
  const lower = createShape("arrow", { x: 190, y: 145 }, { x: 410, y: 230 });
  const starting = {
    ...blankScene(),
    elements: [shared, upper, lower],
  };
  const firstRoute = convertArrowToElbow(starting, upper.id);
  const routed = convertArrowToElbow(firstRoute, lower.id);
  const first = reconnectNativeOrbitEndpoint(
    routed, upper.id, "start", { x: 85, y: 88 },
  );
  const second = reconnectNativeOrbitEndpoint(
    first, lower.id, "start", { x: 90, y: 120 },
  );
  return { shared, upper, lower, starting, routed, first, second };
};

describe("shared core-routed orbit targets", () => {
  it("attaches two independent elbow arrows with reciprocal links to one box", () => {
    const { shared, upper, lower, routed, first, second } = connectedPair();
    expect(first).not.toBe(routed);
    expect(second).not.toBe(first);
    expect(second.elements[0].boundElements).toEqual([
      { id: upper.id, type: "arrow" },
      { id: lower.id, type: "arrow" },
    ]);
    for (const id of [upper.id, lower.id]) {
      const arrow = second.elements.find((item) => item.id === id)!;
      expect(isNativeOrbitLinkedArrow(second, arrow)).toBe(true);
      expect(arrow.type).toBe("arrow");
      if (arrow.type !== "arrow") {
        throw new Error("Expected routed arrow");
      }
      expect(arrow.elbowed).toBe(true);
      expect(arrow.startBinding?.mode).toBe("orbit");
      expect(arrow.startBinding?.elementId).toBe(shared.id);
      expect(arrow.endBinding).toBeNull();
      expect(nativeOrbitEndpoints(second, arrow)).not.toBeNull();
    }
    expect(isSafeBoundBox(second, second.elements[0])).toBe(true);
    expect(second.elements[1]).toBe(first.elements[1]);
    expect(parseScene(serializeScene(second))).toEqual(second);
  });

  it("reroutes both arrows when their shared box moves using original core bindings", () => {
    const { shared, upper, lower, second } = connectedPair();
    const before = [upper.id, lower.id].map((id) =>
      nativeOrbitEndpoints(second, second.elements.find((item) => item.id === id)!)!.start,
    );
    const snapshot = structuredClone(second);
    const moved = moveSelection(second, [shared.id], 38, -24);
    expect(moved).not.toBe(second);
    expect(moved.elements[0].x).toBe(shared.x + 38);
    expect(moved.elements[0].y).toBe(shared.y - 24);
    for (const [index, id] of [upper.id, lower.id].entries()) {
      const arrow = moved.elements.find((item) => item.id === id)!;
      expect(isNativeOrbitLinkedArrow(moved, arrow)).toBe(true);
      const after = nativeOrbitEndpoints(moved, arrow)!.start;
      expect(Math.hypot(
        before[index].x - after.x,
        before[index].y - after.y,
      )).toBeGreaterThan(8);
      expect(arrow.type).toBe("arrow");
      if (arrow.type === "arrow") {
        for (let i = 1; i < arrow.points.length; i++) {
          const a = arrow.points[i - 1];
          const b = arrow.points[i];
          expect(
            Math.abs(a[0] - b[0]) < 1e-6 ||
            Math.abs(a[1] - b[1]) < 1e-6,
          ).toBe(true);
        }
      }
    }
    expect(second).toEqual(snapshot);
    const history = new SceneHistory();
    history.commit(second);
    expect(history.undo(moved)).toEqual(second);
    expect(history.redo(second)).toEqual(moved);
    expect(parseScene(serializeScene(moved))).toEqual(moved);
  });

  it("reconnects or deletes only one arrow without discarding its sibling", () => {
    const { shared, upper, lower, second } = connectedPair();
    const target = createShape("diamond", { x: 550, y: 60 }, { x: 680, y: 190 });
    const withTarget = { ...second, elements: [...second.elements, target] };
    const retargeted = reconnectNativeOrbitEndpoint(
      withTarget, upper.id, "start", { x: 615, y: 125 },
    );
    expect(retargeted).not.toBe(withTarget);
    expect(retargeted.elements[0].boundElements).toEqual([
      { id: lower.id, type: "arrow" },
    ]);
    expect(retargeted.elements[3].boundElements).toEqual([
      { id: upper.id, type: "arrow" },
    ]);
    expect(isNativeOrbitLinkedArrow(retargeted, retargeted.elements[1]))
      .toBe(true);
    expect(isNativeOrbitLinkedArrow(retargeted, retargeted.elements[2]))
      .toBe(true);

    const detached = reconnectNativeOrbitEndpoint(
      second, upper.id, "start", { x: 340, y: 300 },
    );
    expect(detached).not.toBe(second);
    expect(detached.elements[0].boundElements).toEqual([
      { id: lower.id, type: "arrow" },
    ]);
    expect(isNativeOrbitLinkedArrow(detached, detached.elements[2]))
      .toBe(true);

    const deleted = deleteSelection(second, [upper.id]);
    expect(deleted.elements[1].isDeleted).toBe(true);
    expect(deleted.elements[0].boundElements).toEqual([
      { id: lower.id, type: "arrow" },
    ]);
    expect(isNativeOrbitLinkedArrow(deleted, deleted.elements[2]))
      .toBe(true);
    expect(deleted.elements[0].id).toBe(shared.id);
  });

  it("fails closed for a malformed sibling, duplicate reference or mixed inside arrow", () => {
    const { shared, upper, lower, second } = connectedPair();
    const corrupt = {
      ...second,
      elements: second.elements.map((item) =>
        item.id === lower.id && item.type === "arrow"
          ? {
              ...item,
              startBinding: item.startBinding && {
                ...item.startBinding,
                mode: "inside" as const,
              },
            }
          : item,
      ),
    };
    expect(isNativeOrbitLinkedArrow(corrupt, corrupt.elements[1])).toBe(false);
    expect(isSafeBoundBox(corrupt, corrupt.elements[0])).toBe(false);
    expect(reconnectNativeOrbitEndpoint(
      corrupt, upper.id, "end", { x: 610, y: 100 },
    )).toBe(corrupt);
    expect(moveSelection(corrupt, [shared.id], 20, 15)).toBe(corrupt);

    const duplicate = {
      ...second,
      elements: second.elements.map((item) =>
        item.id === shared.id
          ? {
              ...item,
              boundElements: [
                ...(item.boundElements ?? []),
                { id: upper.id, type: "arrow" as const },
              ],
            }
          : item,
      ),
    };
    expect(isNativeOrbitLinkedArrow(duplicate, duplicate.elements[2]))
      .toBe(false);
    expect(reconnectNativeOrbitEndpoint(
      duplicate, lower.id, "end", { x: 620, y: 100 },
    )).toBe(duplicate);
    const foreign = createShape(
      "rectangle",
      { x: 690, y: 40 },
      { x: 810, y: 155 },
    );
    const orphan = {
      ...second,
      elements: [
        ...second.elements,
        {
          ...foreign,
          boundElements: [{ id: upper.id, type: "arrow" as const }],
        },
      ],
    };
    expect(isNativeOrbitLinkedArrow(orphan, orphan.elements[1])).toBe(false);
    expect(moveSelection(orphan, [shared.id], 30, -12)).toBe(orphan);
    expect(reconnectNativeOrbitEndpoint(
      orphan, lower.id, "end", { x: 620, y: 105 },
    )).toBe(orphan);

    expect(transformSelected(second, shared.id, "se", {
      x: shared.x + shared.width * 2,
      y: shared.y + shared.height * 2,
    })).toBe(second);
  });
});
