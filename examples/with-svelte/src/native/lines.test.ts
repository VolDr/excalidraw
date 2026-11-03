import { describe, expect, it } from "vitest";

import { blankScene, createShape, parseScene, serializeScene } from "./scene";
import { SceneHistory } from "./history";
import {
  canEditEndpoints,
  canEditLinearPoints,
  endpointLocations,
  linearPointLocations,
  moveEndpoint,
  pickEndpoint,
  pickLinearPoint,
  updateLineEndpoint,
  updateLinearPoint,
} from "./lines";

describe("two-point native line endpoints", () => {
  it("moves only the selected arrow endpoint while keeping the other fixed", () => {
    const arrow = createShape("arrow", { x: 100, y: 100 }, { x: 20, y: 40 });
    const original = endpointLocations(arrow);
    expect(original).toEqual({
      start: { x: 100, y: 100 },
      end: { x: 20, y: 40 },
    });
    expect(pickEndpoint(arrow, original!.start)).toBe("start");
    const updated = moveEndpoint(arrow, "end", { x: 150, y: 30 });
    expect(endpointLocations(updated)).toEqual({
      start: original!.start,
      end: { x: 150, y: 30 },
    });
    expect(updated.id).toBe(arrow.id);
    expect(updated.version).toBe(arrow.version + 1);
    expect(arrow.x).toBe(20);
    const scene = { ...blankScene(), elements: [arrow] };
    expect(
      updateLineEndpoint(scene, arrow.id, "end", { x: 150, y: 30 }).elements[0]
        .x,
    ).toBe(100);
  });

  it("preserves rotated endpoint coordinates through core math and mutations", () => {
    const line = createShape("line", { x: 40, y: 40 }, { x: 160, y: 100 });
    const rotated = {
      ...line,
      angle: (Math.PI / 2) as typeof line.angle,
    };
    const endpoints = endpointLocations(rotated)!;
    expect(endpoints.start.x).toBeCloseTo(130);
    expect(endpoints.start.y).toBeCloseTo(10);
    expect(endpoints.end.x).toBeCloseTo(70);
    expect(endpoints.end.y).toBeCloseTo(130);
    const moved = moveEndpoint(rotated, "start", { x: 150, y: -10 });
    const changed = endpointLocations(moved)!;
    expect(changed.start).toEqual({ x: 150, y: -10 });
    expect(changed.end.x).toBeCloseTo(endpoints.end.x);
    expect(changed.end.y).toBeCloseTo(endpoints.end.y);
    expect(moved.angle).toBe(rotated.angle);
    expect(moved.version).toBe(rotated.version + 1);
    expect(rotated.points).toEqual(line.type === "line" ? line.points : []);
  });

  it("keeps a reversed arrow's opposite endpoint fixed through core normalization", () => {
    const arrow = createShape("arrow", { x: 220, y: 150 }, { x: 40, y: 35 });
    const original = endpointLocations(arrow)!;
    const source = {
      ...blankScene(),
      elements: [
        arrow,
        { ...createShape("rectangle", { x: 330, y: 60 }, { x: 430, y: 160 }),
          customData: { author: "external" } },
      ],
      customData: { preserved: true },
    };
    const unrelated = source.elements[1];
    const snapshot = structuredClone(source);
    const moved = updateLineEndpoint(source, arrow.id, "start", { x: 310, y: 80 });
    expect(moved).not.toBe(source);
    const after = endpointLocations(moved.elements[0])!;
    expect(after.start.x).toBeCloseTo(310, 2);
    expect(after.start.y).toBeCloseTo(80, 2);
    expect(after.end.x).toBeCloseTo(original.end.x, 2);
    expect(after.end.y).toBeCloseTo(original.end.y, 2);
    expect(moved.elements[0].version).toBe(arrow.version + 1);
    expect(moved.elements[0].index).toBe(arrow.index);
    expect(moved.elements[1]).toBe(unrelated);
    expect(moved.customData).toEqual(source.customData);
    expect(source).toEqual(snapshot);
    const history = new SceneHistory();
    history.commit(source);
    expect(history.undo(moved)).toEqual(source);
    expect(history.redo(source)).toEqual(moved);
    expect(parseScene(serializeScene(moved))).toEqual(moved);
  });

  it("does not make a new scene for a no-op, missing ID or nonfinite pointer", () => {
    const line = createShape("line", { x: 170, y: 80 }, { x: 30, y: 10 });
    const scene = { ...blankScene(), elements: [line] };
    const start = endpointLocations(line)!.start;
    expect(updateLineEndpoint(scene, line.id, "start", start)).toBe(scene);
    expect(moveEndpoint(line, "start", start)).toBe(line);
    expect(updateLineEndpoint(scene, "nonexistent", "end", { x: 10, y: 15 }))
      .toBe(scene);
    expect(updateLineEndpoint(scene, line.id, "end", { x: NaN, y: 15 }))
      .toBe(scene);
    expect(updateLineEndpoint(scene, line.id, "end", { x: 15, y: Infinity }))
      .toBe(scene);
  });

  it("moves a middle vertex using Excalidraw without changing its neighbors", () => {
    const originalLine = createShape(
      "line",
      { x: 20, y: 30 },
      { x: 220, y: 130 },
    );
    if (originalLine.type !== "line") {
      throw new Error("Expected ordinary line");
    }
    const line = {
      ...originalLine,
      points: [[0, 0], [50, 20], [110, 80], [200, 100]]
        as typeof originalLine.points,
      customData: { imported: true },
    };
    const foreign = createShape(
      "rectangle",
      { x: 400, y: 50 },
      { x: 530, y: 160 },
    );
    const scene = { ...blankScene(), elements: [line, foreign] };
    const snapshot = structuredClone(scene);
    const points = linearPointLocations(line)!;
    expect(points).toHaveLength(4);
    expect(canEditLinearPoints(line)).toBe(true);
    expect(canEditEndpoints(line)).toBe(false);
    expect(pickLinearPoint(line, points[1])).toBe(1);

    const updated = updateLinearPoint(scene, line.id, 1, {
      x: points[1].x + 35,
      y: points[1].y - 27,
    });
    expect(updated).not.toBe(scene);
    const next = updated.elements[0];
    const actual = linearPointLocations(next)!;
    expect(actual[1].x).toBeCloseTo(points[1].x + 35, 2);
    expect(actual[1].y).toBeCloseTo(points[1].y - 27, 2);
    for (const i of [0, 2, 3]) {
      expect(actual[i].x).toBeCloseTo(points[i].x, 2);
      expect(actual[i].y).toBeCloseTo(points[i].y, 2);
    }
    expect(next.id).toBe(line.id);
    expect(next.version).toBe(line.version + 1);
    expect(next.index).toBe(line.index);
    expect(next.customData).toEqual(line.customData);
    expect(updated.elements[1]).toBe(foreign);
    expect(scene).toEqual(snapshot);
    const history = new SceneHistory();
    history.commit(scene);
    expect(history.undo(updated)).toEqual(scene);
    expect(history.redo(scene)).toEqual(updated);
    expect(parseScene(serializeScene(updated))).toEqual(updated);
  });

  it("preserves every other point when dragging a reversed rotated arrow vertex", () => {
    const shape = createShape(
      "arrow",
      { x: 260, y: 180 },
      { x: 30, y: 20 },
    );
    if (shape.type !== "arrow") {
      throw new Error("Expected arrow");
    }
    const arrow = {
      ...shape,
      angle: (Math.PI / 6) as typeof shape.angle,
      points: [[230, 160], [150, 65], [65, 120], [0, 0]]
        as typeof shape.points,
    };
    const scene = { ...blankScene(), elements: [arrow] };
    const oldPoints = linearPointLocations(arrow)!;
    expect(oldPoints).toHaveLength(4);
    const changed = updateLinearPoint(scene, arrow.id, 2, {
      x: oldPoints[2].x + 26,
      y: oldPoints[2].y + 15,
    });
    expect(changed).not.toBe(scene);
    const result = changed.elements[0];
    expect(result.angle).toBe(arrow.angle);
    const newPoints = linearPointLocations(result)!;
    for (const i of [0, 1, 3]) {
      expect(newPoints[i].x).toBeCloseTo(oldPoints[i].x, 2);
      expect(newPoints[i].y).toBeCloseTo(oldPoints[i].y, 2);
    }
    expect(newPoints[2].x).toBeCloseTo(oldPoints[2].x + 26, 2);
    expect(newPoints[2].y).toBeCloseTo(oldPoints[2].y + 15, 2);
    expect(arrow.points).toEqual(scene.elements[0].type === "arrow"
      ? scene.elements[0].points : []);
  });

  it("rejects malformed, bound and unsupported polyline edits atomically", () => {
    const base = createShape("line", { x: 20, y: 20 }, { x: 220, y: 120 });
    if (base.type !== "line") {
      throw new Error("Expected line");
    }
    const polyline = {
      ...base,
      points: [[0, 0], [80, 60], [200, 100]] as typeof base.points,
    };
    const inputs = [
      { ...polyline, locked: true },
      { ...polyline, groupIds: ["group"] },
      { ...polyline, frameId: "frame" },
      { ...polyline, polygon: true },
      { ...polyline, boundElements: [{ id: "label", type: "text" as const }] },
      { ...polyline, angle: Number.NaN as typeof base.angle },
      { ...polyline, points: [[0, 0], [NaN, 6], [200, 100]] as typeof base.points },
      { ...polyline, points: Array.from({ length: 129 }, (_, i) => [i, i]) as typeof base.points },
    ];
    for (const item of inputs) {
      expect(canEditLinearPoints(item)).toBe(false);
      const source = { ...blankScene(), elements: [item] };
      expect(updateLinearPoint(source, item.id, 1, { x: 70, y: 50 }))
        .toBe(source);
    }
    const source = { ...blankScene(), elements: [polyline] };
    const existing = linearPointLocations(polyline)![1];
    expect(updateLinearPoint(source, polyline.id, 1, existing)).toBe(source);
    expect(updateLinearPoint(source, polyline.id, -1, { x: 30, y: 30 })).toBe(source);
    expect(updateLinearPoint(source, polyline.id, 3, { x: 30, y: 30 })).toBe(source);
    expect(updateLinearPoint(source, polyline.id, 0, { x: NaN, y: 30 })).toBe(source);
    expect(pickLinearPoint(polyline, { x: NaN, y: 1 })).toBeNull();

    // External dangling reverse references must not be repaired implicitly.
    const external = {
      ...createShape("rectangle", { x: 400, y: 30 }, { x: 500, y: 130 }),
      boundElements: [{ id: polyline.id, type: "arrow" as const }],
    };
    const orphan = { ...source, elements: [polyline, external] };
    expect(updateLinearPoint(orphan, polyline.id, 1, { x: 70, y: 50 }))
      .toBe(orphan);
  });

  it("rejects bound, grouped, framed, locked and complex paths", () => {
    const line = createShape("line", { x: 0, y: 0 }, { x: 50, y: 50 });
    const cases = [
      { ...line, locked: true },
      { ...line, frameId: "frame-1" },
      { ...line, groupIds: ["g"] },
      { ...line, boundElements: [{ id: "text", type: "text" as const }] },
      {
        ...line,
        points: [...(line.type === "line" ? line.points : []), [70, 80]],
      },
      { ...line, polygon: true },
      { ...line, angle: NaN as typeof line.angle },
      { ...line, points: [[NaN, 0], [50, 50]] },
    ];
    for (const element of cases) {
      expect(canEditEndpoints(element as typeof line)).toBe(false);
      expect(
        moveEndpoint(element as typeof line, "start", { x: 5, y: 5 }),
      ).toBe(element);
    }
  });

  it("recognizes end handles only near endpoint coordinates", () => {
    const line = createShape("line", { x: 0, y: 0 }, { x: 100, y: 100 });
    expect(pickEndpoint(line, { x: 100, y: 99 }, 8)).toBe("end");
    expect(pickEndpoint(line, { x: 50, y: 50 }, 8)).toBeNull();
  });
});
