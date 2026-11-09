import { describe, expect, it } from "vitest";
import { blankScene, createShape } from "./scene";
import { groupSelection } from "./groups";
import {
  createNativeFrameWithCore, wrapNativeSelectionInFrame, unwrapNativeFrame,
} from "./frames";

describe("native frame APIs from original Excalidraw core", () => {
  it("creates frame from a drag and auto-includes fully contained shapes", () => {
    const a = createShape("rectangle", { x: 40, y: 40 }, { x: 110, y: 110 });
    const b = createShape("ellipse", { x: 230, y: 30 }, { x: 310, y: 110 });
    const source = { ...blankScene(), elements: [a, b] };
    const created = createNativeFrameWithCore(
      source, { x: 20, y: 20 }, { x: 180, y: 160 },
    );
    expect(created).not.toBeNull();
    expect(created?.scene.elements.find((e) => e.id === a.id)?.frameId)
      .toBe(created?.frame.id);
    expect(created?.scene.elements.find((e) => e.id === b.id)?.frameId).toBeNull();
    expect(source.elements[0]).toBe(a);
  });

  it("wraps complete groups, preserving original ancestry, and unwraps children", () => {
    const a = createShape("rectangle", { x: 20, y: 20 }, { x: 100, y: 100 });
    const b = createShape("diamond", { x: 150, y: 20 }, { x: 260, y: 100 });
    const source = groupSelection(
      { ...blankScene(), elements: [a, b] }, [a.id, b.id],
    );
    const framed = wrapNativeSelectionInFrame(source.scene, [a.id, b.id]);
    expect(framed?.frame.type).toBe("frame");
    expect(framed?.scene.elements.filter((el) =>
      el.id === a.id || el.id === b.id
    ).every((el) => el.frameId === framed.frame.id)).toBe(true);
    const unwrapped = unwrapNativeFrame(framed!.scene, framed!.frame.id);
    expect(unwrapped.elements.find((el) => el.id === framed!.frame.id)?.isDeleted)
      .toBe(true);
    expect(unwrapped.elements.filter((el) =>
      el.id === a.id || el.id === b.id
    ).every((el) => el.frameId === null)).toBe(true);
  });
});
