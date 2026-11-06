import { describe, expect, it } from "vitest";
import { blankScene, createShape } from "./scene";
import { appendNativeArrow, isNativeLinkedArrow } from "./bindings";
import {
  missingNativeImportedBindings,
  repairNativeImportedBindings,
} from "./importedBindings";

describe("explicit import repair delegates to original binding core", () => {
  const sample = () => {
    const boxA = createShape("rectangle", { x: 10, y: 20 }, { x: 140, y: 130 });
    const boxB = createShape("ellipse", { x: 270, y: 10 }, { x: 380, y: 130 });
    const arrow = createShape("arrow", { x: 90, y: 65 }, { x: 295, y: 65 });
    const connected = appendNativeArrow(
      { ...blankScene(), elements: [boxA, boxB] },
      arrow,
      { x: 90, y: 65 },
      { x: 295, y: 65 },
    );
    const attached = connected.elements.find((element) => element.type === "arrow");
    if (attached?.type !== "arrow" ||
        !attached.startBinding || !attached.endBinding) throw Error("No core binding");
    return { connected, boxA, boxB, arrow: attached };
  };

  it("restores a missing reverse ref without altering other shapes or endpoint targets", () => {
    const { connected, boxA, boxB, arrow } = sample();
    const imported = {
      ...connected,
      elements: connected.elements.map((element) =>
        element.id === boxA.id
          ? { ...element, boundElements: null }
          : element,
      ),
    };
    expect(missingNativeImportedBindings(imported)).toEqual([
      { arrowId: arrow.id, boxId: boxA.id, end: "start" },
    ]);
    const repaired = repairNativeImportedBindings(imported);
    expect(repaired).not.toBe(imported);
    const after = repaired.elements.find((e) => e.id === arrow.id)!;
    expect(isNativeLinkedArrow(repaired, after)).toBe(true);
    expect(repaired.elements.find((e) => e.id === boxA.id)?.boundElements)
      .toEqual([{ id: arrow.id, type: "arrow" }]);
    expect(repaired.elements.find((e) => e.id === boxB.id))
      .toBe(imported.elements.find((e) => e.id === boxB.id));
    expect(missingNativeImportedBindings(repaired)).toEqual([]);
    expect(imported.elements[0].boundElements).toBeNull();
  });

  it("leaves unsupported imported styles of binding untouched", () => {
    const { connected, boxA, arrow } = sample();
    const damaged = {
      ...connected,
      elements: connected.elements.map((element) =>
        element.id === arrow.id && element.type === "arrow"
          ? { ...element, startBinding: {
              ...element.startBinding!, mode: "orbit" as const,
            } }
          : element.id === boxA.id
            ? { ...element, boundElements: null }
            : element,
      ),
    };
    expect(missingNativeImportedBindings(damaged)).toHaveLength(0);
    expect(repairNativeImportedBindings(damaged)).toBe(damaged);
  });
});
