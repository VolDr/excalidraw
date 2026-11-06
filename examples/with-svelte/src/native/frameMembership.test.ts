import { describe, expect, it } from "vitest";
import { blankScene, createShape } from "./scene";
import { createNativeFrameWithCore } from "./frames";
import { resizeNativeFrameWithCore } from "./frameResize";

describe("frame resize membership uses original Excalidraw frame APIs", () => {
  it("captures an independently editable rectangle as the frame grows", () => {
    const inside = createShape("rectangle", { x: 50, y: 40 }, { x: 100, y: 100 });
    const outside = createShape("rectangle", { x: 255, y: 40 }, { x: 300, y: 100 });
    const source = {
      ...blankScene(), elements: [inside, outside],
    };
    const created = createNativeFrameWithCore(
      source, { x: 20, y: 20 }, { x: 200, y: 160 },
    );
    if (!created) throw Error("Expected frame");
    expect(created.scene.elements.find((el) => el.id === outside.id)?.frameId)
      .toBeNull();

    const next = resizeNativeFrameWithCore(
      created.scene, created.frame.id, "se", { x: 350, y: 180 },
    );
    expect(next).not.toBe(created.scene);
    expect(next.elements.find((el) => el.id === outside.id)?.frameId)
      .toBe(created.frame.id);
    expect(next.elements.find((el) => el.id === inside.id)?.frameId)
      .toBe(created.frame.id);
    expect(source.elements.find((el) => el.id === outside.id)?.frameId)
      .toBeNull();
  });

  it("releases a simple root if completely outside shrunken frame", () => {
    const box = createShape("rectangle", { x: 160, y: 80 }, { x: 225, y: 145 });
    const created = createNativeFrameWithCore(
      { ...blankScene(), elements: [box] },
      { x: 20, y: 20 }, { x: 245, y: 175 },
    );
    if (!created) throw Error("Expected frame");
    const result = resizeNativeFrameWithCore(
      created.scene, created.frame.id, "se", { x: 100, y: 65 },
    );
    expect(result.elements.find((el) => el.id === box.id)?.frameId)
      .toBeNull();
    expect(result.elements.find((el) => el.id === box.id)?.x).toBe(box.x);
  });
});
