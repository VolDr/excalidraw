# Svelte migration: Excalidraw core reuse audit

The migration must **reuse Excalidraw's domain logic**, not create a
second geometry/binding engine. Svelte is the UI host. This file tracks
actual imports and the remaining architectural debt; the current PR is
still an unverified draft.

## Reused directly in `examples/with-svelte`

| Native adapter | Existing Excalidraw implementation | Current usage |
| --- | --- | --- |
| `native/scene.ts` | `@excalidraw/element`: `newElement`, `newLinearElement`, `newArrowElement`, `newTextElement`, `newFreeDrawElement`, `getTextAnchorRatios`, `measureText`, `wrapText`, `hitElementItself`; `@excalidraw/math`: `pointFrom` | All native shape constructors, text metrics, precise pointer hit tests |
| `native/selection.ts` | `@excalidraw/element`: `getElementBounds`, `elementsOverlappingBBox`, `duplicateElement`, `fixDuplicatedBindingsAfterDuplication` | Type-aware rotated bounds, marquee geometry, deep copy, ID/seed creation and reciprocal link remapping |
| `native/groups.ts` | `@excalidraw/element`: `getElementsInGroup`, `addToGroup`, `removeFromSelectedGroups` | Group membership and ID-array modifications |
| `native/groupTransforms.ts` | `@excalidraw/element`: `getCommonBounds`, `rescalePointsInElement`, core `resizeMultipleElements` and `transformElements` via adapter, bound-text dimensions; `@excalidraw/math`: `pointRotateRads` | Plain flat-box groups now delegate uniform resize and rotation to core; mixed/linked groups retain conservative native policies |
| `native/transforms.ts` | `@excalidraw/element`: `getNextSingleWidthAndHeightFromPointer`, core `dragSelectedElements`, `resizeSingleElement` and `transformElements` via adapter; `@excalidraw/math`: `pointRotateRads` | Dragging and single-box resize/rotation delegate to core, including one reciprocal bound-text label; raster images and complex links retain guarded legacy behavior |
| `native/lines.ts` | `@excalidraw/element`: `LinearElementEditor`, `newElementWith` (via adapter) | Official world-space linear endpoint geometry, normalized lines and version/nonce updates |
| `native/bindings.ts` | `@excalidraw/element`: `LinearElementEditor`, `intersectElementWithLineSegment`, `calculateFixedPointForNonElbowArrowBinding`, `getGlobalFixedPointForBindableElement`; `@excalidraw/math`: `pointRotateRads`, `pointFrom` | Official endpoint geometry, outline intersections, fixed-point attachment ratios and anchor coordinates for safe simple arrows |
| `native/coreAdapter.ts` | `@excalidraw/element`: `Scene`, `newElementWith`, `dragSelectedElements`, `resizeSingleElement`, `resizeMultipleElements`, `transformElements`, `getNextSingleWidthAndHeightFromPointer`, `fixBindingsAfterDeletion`, text measurement limits | Isolated Scene-backed dragging, single-box resize/rotation with core bound-label layout, plain-group multi-transforms, mutation/version preservation, reciprocal cleanup |
| `native/boundText.ts` | `@excalidraw/element`: `computeBoundTextPosition`, `computeContainerDimensionForBoundText`, `getBoundTextMaxWidth`, `getBoundTextMaxHeight`, `measureText`, `wrapText`, `normalizeText` | Reciprocal text placement and dimension constraints |

The conservative, flat-group and reciprocal-single-label checks are
**compatibility policy**, not substitutes for Excalidraw's geometry.
They reject edits we cannot yet model safely.

The native adapter deliberately retains append-order, `index: null`, and
`version: 1` for duplicated elements as a **temporary policy** even though
`duplicateElement` supplies the identity, deep copy, groups, seed and
timestamps. The original `fixDuplicatedBindingsAfterDuplication` now rewrites
both sides of reciprocal label links on copies. Fractional-index and
full document-order parity is pending.

For native hit-testing the adapter passes
`overrideShouldTestInside: true`: its selection UI currently allows
clicking inside transparent shapes, whereas Excalidraw's default selection
semantics may select only the outline. This is a deliberate UI distinction
until the entire interaction policy is ported.

## Still custom: do not mistake these for parity

| Area | Existing core | Why not swapped wholesale yet |
| --- | --- | --- |
| Remaining arrow binding lifecycle (`native/bindings.ts`) | `packages/element/src/binding.ts`: `updateBoundElements`, `getGlobalFixedPoints`, `bindOrUnbindBindingElement` | Fixed-point calculations and deletion cleanup now reuse core. Live endpoint dragging, attaching, detaching and moving still use restricted native glue; full behavior requires `Scene`, mutable maps and binding strategies. |
| Remaining resize and rotation | `packages/element/src/resizeElements.ts` | `resizeSingleElement` and `transformElements` now handle independent boxes and single intact reciprocal bound-text pairs. `resizeMultipleElements`/`transformElements` handle plain flat-box groups. Bound-text groups, images, mixed linear objects and unsupported imports still need additional parity work. |
| Drag interaction completeness | `packages/element/src/dragElements.ts`: `dragSelectedElements` | Basic native movement now delegates to this original engine with an isolated synthetic original-elements pointer snapshot; grid snapping, modifiers, nested frame interactions and the full React pointer state have not been ported. |
| Full selection semantics | `packages/element/src/selection.ts`, `packages/element/src/bounds.ts` | Marquee geometry now uses `elementsOverlappingBBox`; selection state, nested groups, locked elements and frames still need a real Svelte state adapter. |
| Undo/redo | `packages/element/src/store.ts` plus the original editor's history | The current snapshot history is intentionally independent, not granular Excalidraw history. |
| Rendering | `packages/element/src/shape.ts`, `renderElement.ts`, `packages/excalidraw/scene` | Current native Canvas/Rough.js rendering does not yet reproduce all Excalidraw drawables or interaction overlays. |

## Required next refactor (before claiming parity)

1. Extend the already working-in-code `withNativeCoreScene` bridge from
   deletion, native selection drag and unbound-box resize to linked arrow
   reconnect/resize workflows after parity tests are actually run.
2. Replace remaining arrow endpoint binding, raster-image transforms and
   **mixed/grouped linear + bound text** transformations with core algorithms
   after cross-editor tests.
3. Reuse Excalidraw's fractional indexing, source element-order handling,
   and native history transaction semantics.
4. Reuse the official rendering and hit-test pipeline where possible; test
   rounded corners, elbow arrows, bound arrow labels, cropped images and frames.
5. Add roundtrip/behavior parity fixtures with the React editor **and run them**
   in an environment that has the repository dependencies. No CI or local
   package test result is claimed by this audit.

### Latest native core integrations

The Svelte selection move path now invokes `dragSelectedElements` with the
original-elements snapshot extracted from an isolated `Scene`. The official
drag implementation updates reciprocal arrow geometry and bound text as
appropriate; Svelte keeps its strict editable-selection policy and the
explicit label layout reconciliation. For unbound native rectangles, ellipses
and diamonds, Svelte now delegates resize to `resizeSingleElement`, while
preserving an 8px minimum and refusing orphan/malformed bindings. Images and
bound text boxes still use their restricted native geometry path.

For a *complete* flat group of plain rectangles, ellipses and diamonds,
uniform corner resizing now invokes Excalidraw's `resizeMultipleElements`,
and rotation invokes its `transformElements` with the original
`"rotation"` handle. These operations run on an isolated `Scene`, not the
Svelte editor's source objects. They refuse partial groups, orphaned external
bindings, locked members, frames and other unsupported imported geometry.
Grouped labels, images, and straight arrows deliberately still use the
guarded native transform until core parity fixtures can be executed.

Native single-box resize and rotation now also use Excalidraw's
`resizeSingleElement` / `transformElements` for an intact reciprocal
rectangle/ellipse/diamond + one text label. The core's
`handleBindTextResize` path owns label wrapping and position. The adapter
accepts a transaction only if the original label ID, container link,
unwrapped text and calculated width/height constraints survive. Foreign
reverse references, orphan labels, arrow bindings and invalid geometry stay
read-only. A failed postcondition returns the exact original scene.

The clipboard's maximum element count is shared between copy and paste, so
cutting 1001 or more elements no longer deletes content that cannot be pasted
back. A regression fixture covers this destructive-mismatch case.

**None of the newly authored tests or CI workflows have been executed.**
These imports and parity checks must be validated before release.

### Core Scene mutation isolation

A temporary `Scene` created from Svelte's JSON snapshot always invokes
`syncInvalidIndices`, which may regenerate fractional indices and bump
versions even without a user action. `withNativeCoreScene` records the
post-construction version baseline and imports **only actual subsequent
mutations**, normalizes their version delta to the original, and keeps
original indices, ordering, and unrelated object identities. Unchanged
transactions return the identical source scene reference. Tests cover these
invariants, but have not yet been executed.

React components must stay in the lazy fallback until their UI and state
counterparts are replaced. A function's TypeScript type import from
`@excalidraw/excalidraw/types` does not necessarily imply a React runtime
dependency, but a runtime `Scene`/`App` requirement does demand proper
adapter design rather than blind substitution.
