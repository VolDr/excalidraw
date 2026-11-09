import { describe, expect, it } from "vitest";

import { blankScene, createShape } from "./scene";
import { applyNativeStyle, nativeStyleTarget } from "./styles";

describe("native Svelte style adapter", () => {
  it("uses Excalidraw immutable updates without changing unrelated elements", () => {
    const box = createShape("rectangle", { x: 10, y: 10 }, { x: 140, y: 95 });
    const unrelated = createShape("ellipse", { x: 200, y: 10 }, { x: 280, y: 90 });
    const source = { ...blankScene(), elements: [box, unrelated] };
    const result = applyNativeStyle(source, box.id, { key: "strokeColor", value: "#0088ff" });
    expect(result).not.toBe(source);
    expect(result.elements[0].strokeColor).toBe("#0088ff");
    expect(result.elements[0].version).toBeGreaterThan(box.version);
    expect(result.elements[1]).toBe(unrelated);
    expect(source.elements[0]).toBe(box);
    expect(applyNativeStyle(result, box.id, { key: "strokeColor", value: "#0088ff" })).toBe(result);
  });

  it("allows core-rendered arrowheads only on unbound simple arrows", () => {
    const arrow = createShape("arrow", { x: 0, y: 0 }, { x: 100, y: 50 });
    const source = { ...blankScene(), elements: [arrow] };
    const next = applyNativeStyle(source, arrow.id, { key: "endArrowhead", value: "triangle" });
    expect(next.elements[0].type).toBe("arrow");
    if (next.elements[0].type === "arrow") {
      expect(next.elements[0].endArrowhead).toBe("triangle");
    }
    const malformed = {
      ...source,
      elements: [{ ...arrow, startBinding: { elementId: "missing" } } as typeof arrow],
    };
    expect(applyNativeStyle(malformed, arrow.id, { key: "endArrowhead", value: "triangle" })).toBe(malformed);
  });

  it("rejects groups, locks, invalid colors and fractional opacity", () => {
    const box = createShape("diamond", { x: 0, y: 0 }, { x: 80, y: 80 });
    const source = { ...blankScene(), elements: [box] };
    expect(applyNativeStyle(source, box.id, { key: "strokeColor", value: "red" })).toBe(source);
    expect(applyNativeStyle(source, box.id, { key: "opacity", value: Infinity })).toBe(source);
    expect(applyNativeStyle(source, box.id, { key: "opacity", value: 23.5 })).toBe(source);
    const locked = { ...source, elements: [{ ...box, locked: true }] };
    expect(nativeStyleTarget(locked, box.id)).toBeNull();
    const grouped = { ...source, elements: [{ ...box, groupIds: ["g"] }] };
    expect(nativeStyleTarget(grouped, box.id)).toBeNull();
  });
});
