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
| `native/groupTransforms.ts` | `@excalidraw/element`: `getCommonBounds`, `rescalePointsInElement`, core `resizeMultipleElements` and `transformElements` via adapter, bound-text dimensions; `@excalidraw/math`: `pointRotateRads` | Flat box groups with intact reciprocal captions now delegate uniform resize/rotation and text scaling/placement to core; image/linear groups remain guarded native paths |
| `native/transforms.ts` | `@excalidraw/element`: `getNextSingleWidthAndHeightFromPointer`, core `dragSelectedElements`, `resizeSingleElement` and `transformElements` via adapter; `@excalidraw/math`: `pointRotateRads` | Dragging, single-box and labeled-box transforms, and uncropped embedded-raster resize/rotation delegate to core; cropped rasters and complex imported links retain guarded legacy paths |
| `native/lines.ts` | `@excalidraw/element`: `LinearElementEditor`, `newElementWith` (via adapter) | All safe open linear vertices (2–128 points) use `getPointsGlobalCoordinates`, `getNormalizeElementPointsAndCoords`, `createPointAt` and `movePoints` in core `Scene`, including reversed/rotated paths |
| `native/bindings.ts` | `@excalidraw/element`: `LinearElementEditor`, `intersectElementWithLineSegment`, `getGlobalFixedPointForBindableElement`, core bind/unbind via adapter; `@excalidraw/math`: `pointRotateRads`, `pointFrom` | Official endpoint and outline geometry; creation and reconnect of simple arrows now use the same core binding lifecycle, with strict native target selection |
| `native/coreAdapter.ts` | `@excalidraw/element`: `Scene`, `newElementWith`, `dragSelectedElements`, `resizeSingleElement`, `resizeMultipleElements`, `transformElements`, `LinearElementEditor.createPointAt`/`movePoints`/`getNormalizeElementPointsAndCoords`, `bindBindingElement`, `unbindBindingElement`, `getNextSingleWidthAndHeightFromPointer`, `fixBindingsAfterDeletion`, text measurement limits | Isolated core transforms for boxes/groups/uncropped images, straight line/arrow endpoints and reciprocal simple-arrow bindings, preserving native metadata and unrelated elements |
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
| Remaining complex arrow lifecycle (`native/bindings.ts`) | `packages/element/src/binding.ts`: `bindOrUnbindBindingElement`, `updateBoundElements`, `getGlobalFixedPoints` | Native Svelte can move individual points of unbound open multi-point lines/non-elbow arrows via core `LinearElementEditor`. Binding/rebinding remains restricted to safe two-point non-elbow arrows; elbow routing, multipoint bindings, labels and imported orbit bindings remain unsupported. |
| Remaining resize and rotation | `packages/element/src/resizeElements.ts` | `resizeSingleElement`/`transformElements` now handle boxes, reciprocal text and uncropped embedded images; `resizeMultipleElements` handles flat box groups with their captions. Cropped images, mixed linear groups, frames and unsupported imported bindings still need parity work. |
| Drag interaction completeness | `packages/element/src/dragElements.ts`: `dragSelectedElements` | Basic native movement now delegates to this original engine with an isolated synthetic original-elements pointer snapshot; grid snapping, modifiers, nested frame interactions and the full React pointer state have not been ported. |
| Full selection semantics | `packages/element/src/selection.ts`, `packages/element/src/bounds.ts` | Marquee geometry now uses `elementsOverlappingBBox`; selection state, nested groups, locked elements and frames still need a real Svelte state adapter. |
| Undo/redo | `packages/element/src/store.ts` plus the original editor's history | The current snapshot history is intentionally independent, not granular Excalidraw history. |
| Rendering | `packages/element/src/shape.ts`, `renderElement.ts`, `packages/excalidraw/scene` | Current native Canvas/Rough.js rendering does not yet reproduce all Excalidraw drawables or interaction overlays. |

## Required next refactor (before claiming parity)

1. Validate the already integrated `withNativeCoreScene` paths (deletion,
   dragging, resizing, rotating, simple arrow creation/reconnection) against
   the React editor with actual executed parity tests.
2. Replace **bound** multi-point/elbow/orbit arrow binding, cropped raster
   transforms and **mixed/grouped linear** transforms with the relevant core
   algorithms after cross-editor parity tests.
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
explicit label layout reconciliation. Independent and singly labeled native boxes now use core resize, preserving
native minimum-size rules. Uncropped embedded raster images use core resize
and rotation as well; cropped rasters still retain guarded native geometry.

For a *complete* flat group of plain rectangles, ellipses and diamonds,
uniform corner resizing now invokes Excalidraw's `resizeMultipleElements`,
and rotation invokes its `transformElements` with the original
`"rotation"` handle. These operations run on an isolated `Scene`, not the
Svelte editor's source objects. They refuse partial groups, orphaned external
bindings, locked members, frames and other unsupported imported geometry.
Grouped captions now use the core transform together with their containers.
Groups with images or lines/arrows still use guarded native transforms until
cross-editor parity fixtures can be executed.

Native single-box resize and rotation now also use Excalidraw's
`resizeSingleElement` / `transformElements` for an intact reciprocal
rectangle/ellipse/diamond + one text label. The core's
`handleBindTextResize` path owns label wrapping and position. The adapter
accepts a transaction only if the original label ID, container link,
unwrapped text and calculated width/height constraints survive. Foreign
reverse references, orphan labels, arrow bindings and invalid geometry stay
read-only. A failed postcondition returns the exact original scene.

Flat groups of boxes **with one valid reciprocal caption per container**
now use original Excalidraw `resizeMultipleElements` and
`transformElements`. The core scales caption font sizes, rewraps text and
rotates each bound caption as part of the same `Scene` transaction. A strict
preflight guard confirms complete group membership (including every label),
one-to-one forward/reverse text links and no external arrows or orphan
references. A postflight check rejects the entire transaction if text,
font/angle, original group IDs, fitted bounds or unrelated elements change
unexpectedly. The original snapshot is returned unchanged on rejection.
Group text resize/rotation tests have been added but **not executed**.

Simple arrow creation and endpoint reconnection now share
`bindAndAnchorNativeArrowEndpoint` in `native/coreAdapter.ts`. Binding
and unbinding use Excalidraw's `bindBindingElement` /
`unbindBindingElement` and local point motion uses
`LinearElementEditor.movePoints` in an isolated `Scene`.
Core-normalized fixed points are reapplied to the endpoint to avoid a
subsequent anchor jump. Native hit-testing still chooses supported boxes
and rejects complex imports, missing/duplicate reverse references, external
bindings, non-finite pointers and self-connections. The adapter treats an
empty reverse list as `null` for the native scene format; disconnecting
the last binding leaves an ordinary editable unbound arrow.
New fixtures cover third-target reattachment, same-target deduplication,
last-end detach, no-op gestures, link integrity and undo snapshots. **They
have not been executed.**

Native two-point unbound lines and arrows now delegate endpoint edits
to Excalidraw's `LinearElementEditor.movePoints` in a private `Scene`.
The original normalization method first handles reverse-direction input with
nonzero first local points. After a move, the adapter checks that the dragged
endpoint hit the pointer and the opposite endpoint did not drift, then uses
`newElementWith` to create a single versioned immutable update. Polygon
lines, bound/complex arrows and nonfinite imported paths are refused.

Uncropped embedded raster images now use core `resizeSingleElement` with
the official aspect-ratio pointer projection, and `transformElements` for
rotation. The native no-flip/minimum-size policy is retained. Preflight
checks require a valid local raster, finite positive geometry, no crop and
no foreign links. Postflight checks preserve binary records, source file ID,
flip scale, crop, original aspect ratio and unrelated element identity.
Cropped images intentionally retain the restricted legacy transform path.
Regression fixtures for rotated/reversed line edits and uncropped raster
resize/rotation have been authored **but not executed**.

The Svelte canvas now displays draggable vertex handles for every point
of a selected safe open line or non-elbow arrow, not only its two endpoints.
`native/lines.ts` exposes indexed `linearPointLocations`,
`pickLinearPoint` and `updateLinearPoint` APIs; the native pointer gesture
stores the exact vertex index alongside the existing linked-arrow endpoint
mode. `coreAdapter.ts` uses original Excalidraw point normalization,
`createPointAt` and `movePoints`, then checks in global coordinates that
the dragged vertex reached the pointer and *all other vertices* stayed put.
One immutable `newElementWith` update applies the accepted geometry.
Unsupported polygon/linked/elbow/grouped paths, more than 128 points,
nonfinite geometry and external orphan references remain uneditable.
Regression fixtures for middle-vertex motion, reversed/rotated arrows,
out-of-range indices, imports, metadata and Undo/Redo have been added
**without executing tests or CI**.

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
