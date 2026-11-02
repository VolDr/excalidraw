import { describe, expect, it } from "vitest";

import { blankScene, createShape } from "./scene";
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
    expect(moved.angle).toBe(0);
    expect(moved.version).toBe(rotated.version + 1);
    expect(rotated.points).toEqual(line.type === "line" ? line.points : []);
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
