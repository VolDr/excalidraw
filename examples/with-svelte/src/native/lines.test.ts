import { describe, expect, it } from "vitest";

import { blankScene, createShape, parseScene, serializeScene } from "./scene";
import { SceneHistory } from "./history";
import {
  canEditEndpoints,
  endpointLocations,
  moveEndpoint,
  pickEndpoint,
  updateLineEndpoint,
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
