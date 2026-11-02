# Svelte migration: Excalidraw core reuse audit

The migration must **reuse Excalidraw's domain logic**, not create a
second geometry/binding engine. Svelte is the UI host. This file tracks
actual imports and the remaining architectural debt; the current PR is
still an unverified draft.

## Reused directly in `examples/with-svelte`

| Native adapter | Existing Excalidraw implementation | Current usage |
| --- | --- | --- |
| `native/scene.ts` | `@excalidraw/element`: `newTextElement`, `newFreeDrawElement`, `getTextAnchorRatios`, `measureText`, `wrapText`, `hitElementItself`; `@excalidraw/math`: `pointFrom` | Element creation, text metrics, native pointer hit tests |
| `native/selection.ts` | `@excalidraw/element`: `getElementBounds`, `elementsOverlappingBBox`, `duplicateElement` | Type-aware rotated bounds, marquee geometry, deep copy, ID/seed creation and group remapping |
| `native/groups.ts` | `@excalidraw/element`: `getElementsInGroup`, `addToGroup`, `removeFromSelectedGroups` | Group membership and ID-array modifications |
| `native/groupTransforms.ts` | `@excalidraw/element`: `getCommonBounds`, `rescalePointsInElement`, bound-text dimensions; `@excalidraw/math`: `pointRotateRads` | Group bounds, simple line/arrow point scaling, center rotation and label limits |
| `native/transforms.ts` | `@excalidraw/math`: `pointRotateRads` | Rotated shape handles |
| `native/bindings.ts` | `@excalidraw/math`: `pointRotateRads`, `pointFrom` | World/local coordinates for bound endpoints |
| `native/boundText.ts` | `@excalidraw/element`: `computeBoundTextPosition`, `computeContainerDimensionForBoundText`, `getBoundTextMaxWidth`, `getBoundTextMaxHeight`, `measureText`, `wrapText`, `normalizeText` | Reciprocal text placement and dimension constraints |

The conservative, flat-group and reciprocal-single-label checks are
**compatibility policy**, not substitutes for Excalidraw's geometry.
They reject edits we cannot yet model safely.

The native adapter deliberately retains append-order, `index: null`, and
`version: 1` for duplicated elements as a **temporary policy** even though
`duplicateElement` supplies the identity, deep copy, groups, seed and
timestamps. Fractional-index and document-order parity is pending.

For native hit-testing the adapter passes
`overrideShouldTestInside: true`: its selection UI currently allows
clicking inside transparent shapes, whereas Excalidraw's default selection
semantics may select only the outline. This is a deliberate UI distinction
until the entire interaction policy is ported.

## Still custom: do not mistake these for parity

| Area | Existing core | Why not swapped wholesale yet |
| --- | --- | --- |
| Arrow bindings (`native/bindings.ts`) | `packages/element/src/binding.ts`: `updateBoundElements`, `getGlobalFixedPoints`, `bindOrUnbindBindingElement`, `fixBindingsAfterDeletion` | Most methods require a `Scene`, mutable `ElementsMap`, binding strategies, and related state. The native scene is an immutable JSON snapshot. A tested adapter is needed to preserve reciprocal links. |
| Resize and rotation | `packages/element/src/resizeElements.ts`: `resizeSingleElement`, `resizeMultipleElements`, `transformElements` | Operations expect native `Scene`, original elements and canvas/editor context. Our limited transform is restricted to straightforward geometry. |
| Dragging | `packages/element/src/dragElements.ts`: `dragSelectedElements` | Requires the editor's `PointerDownState`, `Scene` and updates through mutable infrastructure. |
| Full selection semantics | `packages/element/src/selection.ts`, `packages/element/src/bounds.ts` | Marquee geometry now uses `elementsOverlappingBBox`; selection state, nested groups, locked elements and frames still need a real Svelte state adapter. |
| Undo/redo | `packages/element/src/store.ts` plus the original editor's history | The current snapshot history is intentionally independent, not granular Excalidraw history. |
| Rendering | `packages/element/src/shape.ts`, `renderElement.ts`, `packages/excalidraw/scene` | Current native Canvas/Rough.js rendering does not yet reproduce all Excalidraw drawables or interaction overlays. |

## Required next refactor (before claiming parity)

1. Introduce a React-free scene/state adapter that exposes the element maps,
   binding updates and mutation semantics required by the core functions.
2. Replace native arrow binding and individual/group resize operations with
   their Excalidraw counterparts after cross-editor fixture tests pass.
3. Reuse Excalidraw's fractional indexing, source element-order handling,
   and native history transaction semantics.
4. Reuse the official rendering and hit-test pipeline where possible; test
   rounded corners, elbow arrows, bound arrow labels, cropped images and frames.
5. Add roundtrip/behavior parity fixtures with the React editor **and run them**
   in an environment that has the repository dependencies. No CI or local
   package test result is claimed by this audit.

React components must stay in the lazy fallback until their UI and state
counterparts are replaced. A function's TypeScript type import from
`@excalidraw/excalidraw/types` does not necessarily imply a React runtime
dependency, but a runtime `Scene`/`App` requirement does demand proper
adapter design rather than blind substitution.
