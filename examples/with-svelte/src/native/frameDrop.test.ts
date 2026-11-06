import { describe, expect, it } from "vitest";
import { blankScene, createShape } from "./scene";
import { createNativeFrameWithCore } from "./frames";
import { moveSelection } from "./transforms";
import { reconcileNativeFrameDrop } from "./frameDrop";

describe("original Excalidraw frame membership on pointer drop", () => {
  it("adopts a dragged independent shape when dropped inside a frame", () => {
    const box = createShape("rectangle", { x: 250, y: 55 }, { x: 315, y: 110 });
    const created = createNativeFrameWithCore(
      { ...blankScene(), elements: [box] },
      { x: 10, y: 10 }, { x: 170, y: 165 },
    );
    if (!created) throw Error("Core frame fixture failed");
    const moved = moveSelection(created.scene, [box.id], -200, 0);
    const dropped = reconcileNativeFrameDrop(
      created.scene, moved, [box.id], { x: 70, y: 75 },
    );
    expect(dropped.elements.find((el) => el.id === box.id)?.frameId)
      .toBe(created.frame.id);
    expect(created.scene.elements.find((el) => el.id === box.id)?.frameId)
      .toBeNull();
  });

  it("releases a framed independent shape after dropping fully outside", () => {
    const box = createShape("rectangle", { x: 50, y: 40 }, { x: 120, y: 100 });
    const created = createNativeFrameWithCore(
      { ...blankScene(), elements: [box] },
      { x: 10, y: 10 }, { x: 165, y: 150 },
    );
    if (!created) throw Error("Core frame fixture failed");
    const moved = moveSelection(created.scene, [box.id], 250, 0);
    const dropped = reconcileNativeFrameDrop(
      created.scene, moved, [box.id], { x: 360, y: 70 },
    );
    expect(dropped.elements.find((el) => el.id === box.id)?.frameId).toBeNull();
    expect(created.scene.elements.find((el) => el.id === box.id)?.frameId)
      .toBe(created.frame.id);
  });
});
