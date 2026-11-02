import {
  getCommonBounds,
  getElementBounds,
} from "@excalidraw/element";
import { describe, expect, it } from "vitest";

import type { ElementsMap } from "@excalidraw/element/types";

import { updateNativeBoxLabel } from "./boundText";
import { transformableGroup } from "./groupTransforms";
import { groupSelection, ungroupSelection } from "./groups";
import {
  blankScene,
  createShape,
  hitTest,
  pickElement,
  parseScene,
  serializeScene,
} from "./scene";
import { duplicateSelection, elementsInMarquee, visualBounds } from "./selection";

describe("Excalidraw core algorithm reuse in the Svelte adapter", () => {
  it("uses precise official ellipse bounds, not a rotated rectangle approximation", () => {
    const source = createShape(
      "ellipse",
      { x: 0, y: 0 },
      { x: 100, y: 40 },
    );
    const ellipse = {
      ...source,
      angle: (Math.PI / 4) as typeof source.angle,
    };
    const map = new Map([[ellipse.id, ellipse]]) as ElementsMap;
    const official = getElementBounds(ellipse, map);
    const adapted = visualBounds(ellipse);
    expect(adapted).toEqual({
      x: official[0],
      y: official[1],
      width: official[2] - official[0],
      height: official[3] - official[1],
    });
    const expectedWidth = 2 * Math.hypot(50 / Math.SQRT2, 20 / Math.SQRT2);
    expect(adapted.width).toBeCloseTo(expectedWidth);
    expect(adapted.width).toBeLessThan((100 + 40) / Math.SQRT2);
  });

  it("keeps pointer picking precise and allows inside transparent native boxes", () => {
    const rectangle = createShape(
      "rectangle",
      { x: 10, y: 20 },
      { x: 160, y: 120 },
    );
    const ellipse = createShape(
      "ellipse",
      { x: 250, y: 20 },
      { x: 350, y: 100 },
    );
    const arrow = createShape(
      "arrow",
      { x: 400, y: 50 },
      { x: 490, y: 140 },
    );
    const elements = [rectangle, ellipse, arrow];
    expect(hitTest(rectangle, { x: 75, y: 70 })).toBe(true);
    expect(pickElement(elements, { x: 75, y: 70 })?.id).toBe(rectangle.id);
    expect(hitTest(arrow, { x: 440, y: 90 })).toBe(true);
    expect(hitTest(arrow, { x: 485, y: 55 })).toBe(false);
    expect(pickElement(elements, { x: 485, y: 55 })).toBeNull();
  });

  it("groups, duplicates and ungroups reciprocal bound text without diverging from core bounds", () => {
    const box = createShape(
      "rectangle",
      { x: 20, y: 30 },
      { x: 200, y: 140 },
    );
    const other = createShape(
      "ellipse",
      { x: 270, y: 50 },
      { x: 380, y: 170 },
    );
    const scene = updateNativeBoxLabel(
      { ...blankScene(), elements: [box, other] },
      box.id,
      "Bound label",
    );
    const grouped = groupSelection(scene, [box.id, other.id]);
    expect(grouped.groupId).toBeTruthy();
    const roots = grouped.scene.elements.slice(0, 2);
    const [left, top, right, bottom] = getCommonBounds(roots);
    expect(transformableGroup(grouped.scene, grouped.ids)?.bounds).toEqual({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    });
    const payload = duplicateSelection(grouped.scene, grouped.ids);
    expect(payload.ids).toHaveLength(2);
    const [copyBox, copyEllipse, copyLabel] = payload.scene.elements.slice(3);
    expect(copyBox.id).not.toBe(box.id);
    expect(copyBox.groupIds).toEqual(copyEllipse.groupIds);
    expect(copyLabel.groupIds).toEqual(copyBox.groupIds);
    expect(copyBox.boundElements?.[0].id).toBe(copyLabel.id);
    expect(copyLabel.type === "text" && copyLabel.containerId).toBe(
      copyBox.id,
    );
    expect(parseScene(serializeScene(payload.scene))).toEqual(payload.scene);
    const ungrouped = ungroupSelection(payload.scene, payload.ids);
    expect(ungrouped.ids).toEqual(payload.ids);
    expect(ungrouped.scene.elements.slice(3).every((element) => !element.groupIds.length))
      .toBe(true);
    expect(ungrouped.scene.elements.slice(0, 3)).toEqual(grouped.scene.elements);
  });

  it("keeps official marquee semantics for intersection and enclosure", () => {
    const box = createShape(
      "rectangle",
      { x: 10, y: 10 },
      { x: 110, y: 110 },
    );
    const other = createShape(
      "ellipse",
      { x: 230, y: 20 },
      { x: 330, y: 120 },
    );
    const scene = { ...blankScene(), elements: [box, other] };
    expect(elementsInMarquee(scene, { x: 0, y: 0 }, { x: 115, y: 115 }))
      .toEqual([box.id]);
    expect(elementsInMarquee(scene, { x: 115, y: 115 }, { x: 0, y: 0 }))
      .toEqual([box.id]);
    expect(elementsInMarquee(scene, { x: 300, y: 90 }, { x: 240, y: 30 }))
      .toEqual([]);
  });
});
