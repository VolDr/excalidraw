import { describe, expect, it } from "vitest";

import {
  canEditElbowEndpoints,
  convertArrowToElbow,
  elbowEndpointLocations,
  pickElbowEndpoint,
  updateElbowEndpoint,
} from "./lines";
import {
  appendNativeArrow,
  isNativeLinkedArrow,
} from "./bindings";
import { SceneHistory } from "./history";
import { blankScene, createShape, parseScene, serializeScene } from "./scene";

const ortho = (element: ReturnType<typeof createShape>) => {
  if (element.type !== "arrow") {
    throw new Error("Expected an arrow");
  }
  expect(element.elbowed).toBe(true);
  expect(element.points.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < element.points.length; i++) {
    const prev = element.points[i - 1];
    const next = element.points[i];
    expect(
      Math.abs(prev[0] - next[0]) < 1e-6 ||
      Math.abs(prev[1] - next[1]) < 1e-6,
    ).toBe(true);
  }
};

describe("Svelte core-routed unbound elbow arrows", () => {
  it("converts a two-point arrow through Excalidraw routing and roundtrips", () => {
    const arrow = createShape(
      "arrow",
      { x: 280, y: 220 },
      { x: 35, y: 60 },
    );
    const other = createShape(
      "rectangle",
      { x: 420, y: 120 },
      { x: 540, y: 240 },
    );
    const scene = { ...blankScene(), elements: [arrow, other] };
    const snapshot = structuredClone(scene);

    const converted = convertArrowToElbow(scene, arrow.id);
    expect(converted).not.toBe(scene);
    const result = converted.elements[0];
    ortho(result);
    expect(canEditElbowEndpoints(result)).toBe(true);
    const handles = elbowEndpointLocations(result)!;
    expect(handles.start.x).toBeCloseTo(280, 1);
    expect(handles.start.y).toBeCloseTo(220, 1);
    expect(handles.end.x).toBeCloseTo(35, 1);
    expect(handles.end.y).toBeCloseTo(60, 1);
    expect(pickElbowEndpoint(result, handles.start)).toBe("start");
    expect(pickElbowEndpoint(result, handles.end)).toBe("end");
    expect(result.id).toBe(arrow.id);
    expect(result.index).toBe(arrow.index);
    expect(result.version).toBe(arrow.version + 1);
    expect(result.angle).toBe(0);
    expect(converted.elements[1]).toBe(other);
    expect(scene).toEqual(snapshot);

    const history = new SceneHistory();
    history.commit(scene);
    expect(history.undo(converted)).toEqual(scene);
    expect(history.redo(scene)).toEqual(converted);
    expect(parseScene(serializeScene(converted))).toEqual(converted);
  });

  it("reroutes after dragging either endpoint without moving its opposite", () => {
    const arrow = createShape(
      "arrow",
      { x: 20, y: 20 },
      { x: 250, y: 180 },
    );
    const scene = { ...blankScene(), elements: [arrow] };
    const routed = convertArrowToElbow(scene, arrow.id);
    const initial = elbowEndpointLocations(routed.elements[0])!;
    const endChanged = updateElbowEndpoint(
      routed, arrow.id, "end",
      { x: 310, y: 100 },
    );
    expect(endChanged).not.toBe(routed);
    ortho(endChanged.elements[0]);
    const afterEnd = elbowEndpointLocations(endChanged.elements[0])!;
    expect(afterEnd.start.x).toBeCloseTo(initial.start.x, 1);
    expect(afterEnd.start.y).toBeCloseTo(initial.start.y, 1);
    expect(afterEnd.end.x).toBeCloseTo(310, 1);
    expect(afterEnd.end.y).toBeCloseTo(100, 1);
    expect(endChanged.elements[0].index).toBe(arrow.index);
    expect(endChanged.elements[0].version).toBeGreaterThan(routed.elements[0].version);

    const startChanged = updateElbowEndpoint(
      endChanged, arrow.id, "start",
      { x: 75, y: 260 },
    );
    expect(startChanged).not.toBe(endChanged);
    ortho(startChanged.elements[0]);
    const afterStart = elbowEndpointLocations(startChanged.elements[0])!;
    expect(afterStart.start.x).toBeCloseTo(75, 1);
    expect(afterStart.start.y).toBeCloseTo(260, 1);
    expect(afterStart.end.x).toBeCloseTo(afterEnd.end.x, 1);
    expect(afterStart.end.y).toBeCloseTo(afterEnd.end.y, 1);
    const history = new SceneHistory();
    history.commit(endChanged);
    expect(history.undo(startChanged)).toEqual(endChanged);
  });

  it("rejects unsafe imports, bindings and unchanged endpoints without edits", () => {
    const arrow = createShape("arrow", { x: 30, y: 40 }, { x: 280, y: 170 });
    if (arrow.type !== "arrow") {
      throw new Error("Expected arrow");
    }
    const scene = { ...blankScene(), elements: [arrow] };
    const routed = convertArrowToElbow(scene, arrow.id);
    const result = routed.elements[0];
    ortho(result);
    const start = elbowEndpointLocations(result)!.start;
    expect(updateElbowEndpoint(routed, arrow.id, "start", start)).toBe(routed);
    expect(updateElbowEndpoint(routed, arrow.id, "start", { x: NaN, y: 25 }))
      .toBe(routed);
    expect(pickElbowEndpoint(result, { x: Number.NaN, y: 0 })).toBeNull();
    expect(convertArrowToElbow(routed, arrow.id)).toBe(routed);

    const malformed = {
      ...routed,
      elements: [
        { ...result, points: [[0, 0], [40, 30]] as typeof result.points },
      ],
    };
    expect(canEditElbowEndpoints(malformed.elements[0])).toBe(false);
    expect(updateElbowEndpoint(malformed, arrow.id, "end", { x: 400, y: 400 }))
      .toBe(malformed);

    const locked = { ...scene, elements: [{ ...arrow, locked: true }] };
    expect(convertArrowToElbow(locked, arrow.id)).toBe(locked);
    const grouped = { ...scene, elements: [{ ...arrow, groupIds: ["g"] }] };
    expect(convertArrowToElbow(grouped, arrow.id)).toBe(grouped);
    const multi = {
      ...scene,
      elements: [{
        ...arrow,
        points: [[0, 0], [50, 30], [250, 130]] as typeof arrow.points,
      }],
    };
    expect(convertArrowToElbow(multi, arrow.id)).toBe(multi);
    const external = {
      ...scene,
      elements: [
        arrow,
        {
          ...createShape("rectangle", { x: 410, y: 80 }, { x: 520, y: 190 }),
          boundElements: [{ id: arrow.id, type: "arrow" as const }],
        },
      ],
    };
    expect(convertArrowToElbow(external, arrow.id)).toBe(external);

    const bindingTarget = createShape(
      "rectangle",
      { x: 10, y: 10 },
      { x: 110, y: 110 },
    );
    const bound = appendNativeArrow(
      { ...blankScene(), elements: [bindingTarget] },
      createShape("arrow", { x: 110, y: 60 }, { x: 280, y: 60 }),
      { x: 110, y: 60 },
      { x: 280, y: 60 },
    );
    const linked = bound.elements.find((item) => item.type === "arrow")!;
    expect(isNativeLinkedArrow(bound, linked)).toBe(true);
    expect(convertArrowToElbow(bound, linked.id)).toBe(bound);
  });

  it("rejects manually fixed elbow segments and foreign references", () => {
    const arrow = createShape("arrow", { x: 30, y: 30 }, { x: 280, y: 190 });
    const source = convertArrowToElbow(
      { ...blankScene(), elements: [arrow] },
      arrow.id,
    );
    const routed = source.elements[0];
    if (routed.type !== "arrow" || !routed.elbowed) {
      throw new Error("Expected routed arrow");
    }
    const withFixed = {
      ...source,
      elements: [{
        ...routed,
        fixedSegments: [{
          index: 1,
          start: [0, 0],
          end: [50, 0],
        }],
      } as typeof routed],
    };
    expect(canEditElbowEndpoints(withFixed.elements[0])).toBe(false);
    expect(updateElbowEndpoint(withFixed, arrow.id, "end", { x: 350, y: 250 }))
      .toBe(withFixed);
    const outsider = createShape("rectangle", { x: 450, y: 50 }, { x: 530, y: 150 });
    const orphan = {
      ...source,
      elements: [routed, {
        ...outsider,
        boundElements: [{ id: arrow.id, type: "arrow" as const }],
      }],
    };
    expect(updateElbowEndpoint(orphan, arrow.id, "end", { x: 350, y: 250 }))
      .toBe(orphan);
  });
});
