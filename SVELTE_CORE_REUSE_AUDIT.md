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
| `native/groupEditing.ts` | `@excalidraw/element`: `getElementsInGroup`; original group-ID ancestry | Enter/exit nested group editing levels, select immediate child units and move individual boxes through original core drag/binding updates |
| `native/groups.ts` | `@excalidraw/element`: `getElementsInGroup`, `addToGroup`, `removeFromSelectedGroups` | Complete outer-group selection, nested ancestry validation, wrapping and unwrapping without replacing original group-ID manipulation |
| `native/importedOrbitRepair.ts` | `@excalidraw/element`: original `bindBindingElement` and core orthogonal rerouting | Explicitly restores missing reverse orbit refs of validated imported elbow arrows; no automatic repair or arbitrary normalization |
| `native/importedBindings.ts` | `@excalidraw/element`: `bindBindingElement` through original `Scene` | Explicitly restores missing reverse arrow references in limited legacy inside-bound imports; validates every repaired link and forbids unrelated mutations |
| `native/innerElementTransforms.ts` | `@excalidraw/element`: original `transformElements` using single-element resize/rotation; isolated core Scene | Core resize and rotation for individual validated inner boxes, preserving group ancestry, captions and arrow links |
| `native/linkedGroupTransforms.ts` | `@excalidraw/element`: `resizeMultipleElements`, `transformElements`, original Scene via adapter | Rotates and uniformly resizes complete simple bound-arrow/box groups, including reciprocal captions; rejects any orphaned/unbound or foreign reference after a core transaction |
| `native/groupTransforms.ts` | `@excalidraw/element`: `getCommonBounds`, `rescalePointsInElement`, core `resizeMultipleElements` and `transformElements` via adapter, bound-text dimensions; `@excalidraw/math`: `pointRotateRads` | Nested groups containing boxes, reciprocal captions, unbound two-point lines/arrows and uncropped embedded raster images delegate resize/rotation to core; linked arrows remain guarded |
| `native/transforms.ts` | `@excalidraw/element`: `getTransformHandles`, `getNextSingleWidthAndHeightFromPointer`, core `dragSelectedElements`, `resizeSingleElement` and `transformElements` via adapter; `@excalidraw/math`: `pointRotateRads` | Dragging, single-box and labeled-box transforms, and uncropped embedded-raster resize/rotation delegate to core; cropped rasters and complex imported links retain guarded legacy paths |
| `native/frameDrop.ts` | `@excalidraw/element`: `isCursorInFrame`, `isElementInFrame`, `addElementsToFrame`, `removeElementsFromFrame` | On pointer-up, safely adopts or releases a single unbound root on crossing frame boundaries; preserves history and original ordering |
| `native/frameMove.ts` | `@excalidraw/element`: original `dragSelectedElements` via core Scene | Validates complete frame drags, including all child translations and unchanged external references; rejects incomplete imported group ancestry |
| `native/frameResize.ts` | `@excalidraw/element`: `getTransformHandles`, `transformElements`, `getElementsInResizingFrame` | Frame corner resize through original core; accepts only geometry edits that keep the same frame child set |
| `native/frames.ts` | `@excalidraw/element`: `newFrameElement`, `getElementsInNewFrame`, `addElementsToFrame`, `getCommonBounds`, `removeAllElementsFromFrame` | Frame creation, automatic membership, wrapping selection, drag with original core, unwrapping without deleting children |
| `native/laser.ts` | `@excalidraw/laser-pointer`: original `LaserPointer` stroke smoothing and outline generation | Adds transient non-document laser pointer gestures; native canvas paints returned core polygon, no scene mutation or undo |
| `native/lasso.ts` | `packages/excalidraw/lasso/utils.ts`: original `getLassoSelectedElementIds`, `getElementLineSegments` | Native freehand polygon selection, full-containment/intersection modes, complete safe group selection and frame-aware clipping |
| `native/eraser.ts` | `@excalidraw/element`: original element hit-testing and `fixBindingsAfterDeletion` through core Scene | Adds gesture-based eraser with one history transaction and whole-group/caption-safe deletion |
| `native/complexElbow.ts` | `@excalidraw/element`: `LinearElementEditor.getSegmentMidPoint`, `moveFixedSegment`, `deleteFixedSegment` | Core-owned complex elbow segment dragging/locking and Alt+click release, validating orthogonal routing and reciprocal imported links |
| `native/lines.ts` | `@excalidraw/element`: `LinearElementEditor`, `newElementWith` (via adapter) | Safe open linear vertices (2–128 points) use official point geometry, movement and midpoint insertion/deletion; unbound elbow endpoints expose separate route-aware handles using original core algorithms |
| `native/bindings.ts` | `@excalidraw/element`: `LinearElementEditor`, `intersectElementWithLineSegment`, `getGlobalFixedPointForBindableElement`, core bind/unbind via adapter; `@excalidraw/math`: `pointRotateRads`, `pointFrom` | Both safe two-point `inside` arrows and shared-target elbow `orbit` links use original reciprocal binding operations; orbit cases validate closed multi-arrow components before core rerouting |
| `native/coreAdapter.ts` | `@excalidraw/element`: `Scene`, `newElementWith`, `dragSelectedElements`, `resizeSingleElement`, `resizeMultipleElements`, `transformElements`, `updateElbowArrowPoints`, `validateElbowPoints`, `LinearElementEditor` geometry/point editing, `bindBindingElement`, `unbindBindingElement`, `fixBindingsAfterDeletion`, text measurement limits | Isolated core transforms for boxes, mixed box/two-point-linear/uncropped-image groups, standard line/arrow endpoints, safe unbound elbow conversion/rerouting and reciprocal simple-arrow bindings; preserves scene metadata and unrelated elements |
| `native/renderCore.ts` | `@excalidraw/element`: `ShapeCache.generateElementShape`, `getElementAbsoluteCoords`, `paintTextElementOnCanvas`, `paintImageElementOnCanvas` | Core-generated RoughJS drawables and original pressure-sensitive freehand SVG outlines, including round corners, stroke styles and arrowheads, rendered by the native Svelte canvas with the original rotation center |
| `native/imageCrop.ts` | `@excalidraw/element`: `getUncroppedImageElement`, `cropElement`; `@excalidraw/math`: `pointRotateRads` | Native center-crop and crop reset actions using original crop/source rectangle/rotated geometry |
| `native/viewport.ts` | `@excalidraw/element`: `getCommonBounds`; `@excalidraw/excalidraw` (public export): `zoomToFitBounds` | Svelte commands fit all / selected elements via original bounds and zoom algorithm; only pixel/scene scroll conversion belongs to the host |
| `native/zOrder.ts` | `@excalidraw/element`: `moveOneLeft`, `moveOneRight`, `moveAllLeft`, `moveAllRight`, `Scene`, `validateFractionalIndices` | Core z-order controls and fractional-index updates on complete native selections, including contiguous flat groups and safe bound captions; no custom layer algorithm |
| `native/layout.ts` | `@excalidraw/element`: `alignElements`, `distributeElements`, `Scene` via adapter | Original group-aware bounds, translations and version updates for independent roots, complete nested groups and reciprocal captioned boxes; postchecks reject detached arrow links or broken group ancestry |
| `native/history.ts` | `@excalidraw/element`: `ElementsDelta.calculate`, `ElementsDelta.inverse`, `ElementsDelta.applyTo`, `validateFractionalIndices` | Core delta-based undo/redo for valid same-identity edits with original binding reconciliation and revision semantics; snapshots remain fallback for insertion, deletion, reordering and imported incompatibilities |
| `native/ordering.ts` | `@excalidraw/element`: `syncInvalidIndicesImmutable` | Official fractional-index repair at the insertion boundary, preserving already valid ordering and existing element references |
| `native/textStyles.ts` | `@excalidraw/element`: `redrawTextBoundingBox`, `getTextAnchorRatios`, `Scene` via adapter; `@excalidraw/common`: `getLineHeight` | Standalone text and validated reciprocal box captions use original font metrics, wrapping and container resize; imported/rotated/complex bindings remain guarded |
| `native/styles.ts` | `@excalidraw/element`: `newElementWith` via `updateNativeElement` | Native Svelte style controls for safe independent shapes/text/images: core versioning for fill/stroke/opacity and supported arrowheads; grouped/bound/imported unsafe elements stay read-only |
| `native/complexCaptions.ts` | `@excalidraw/element`: `redrawTextBoundingBox`, `updateBoundElements`, `normalizeText`, bound-text max sizes | Edits captions on closed box/text/arrow groups through original text reflow and arrow rerouting, while verifying target and group invariants |
| `native/boundText.ts` | `@excalidraw/element`: `computeBoundTextPosition`, `computeContainerDimensionForBoundText`, `getBoundTextMaxWidth`, `getBoundTextMaxHeight`, `measureText`, `wrapText`, `normalizeText` | Reciprocal text placement and dimension constraints |

The conservative, whole-group and reciprocal-single-label checks are
**compatibility policy**, not substitutes for Excalidraw's geometry.
They reject edits we cannot yet model safely.

New elements are now assigned fractional indices through the original
`syncInvalidIndicesImmutable` implementation, invoked only on Svelte insertion
commits. Existing valid keys and object identities are preserved; legacy
invalid keys may be repaired when inserted elements require normalization.
`duplicateElement` still supplies identity, deep copy, nested ancestry IDs, seed and
timestamps, and original `fixDuplicatedBindingsAfterDuplication` owns reciprocal
label links. Full document-order reconciliation and history parity remain open.

For native hit-testing the adapter passes
`overrideShouldTestInside: true`: its selection UI currently allows
clicking inside transparent shapes, whereas Excalidraw's default selection
semantics may select only the outline. This is a deliberate UI distinction
until the entire interaction policy is ported.

Native property controls now use a guarded immutable `newElementWith` path
for independent elements, with no homegrown shape geometry. The current
panel exposes stroke/fill colors, fill styles, stroke width, dash style,
roughness, roundness, opacity and supported tips on both ends of simple arrows. The core remains
responsible for every visual stroke/arrowhead. Linked arrows, bound text,
groups and frames are deliberately excluded from style changes pending
correct multi-element semantics. Regression fixtures are authored but not run.

The Svelte app now exposes PNG and SVG export through Excalidraw's
original `exportScene` API, imported on demand without mounting a React
editor. It retains core image loading, fonts, text, frames, clipping and
optional embedded scene metadata. This is distinct from the native canvas
preview, so export correctness does not depend on duplicate Svelte
rendering code. Build and tests remain unexecuted.

Native Svelte exposes four z-order operations via the original
`packages/element/src/zindex.ts` functions. They run in a private core
Scene with a validated, independent selection; the adapter adopts changed
fractional indices and array order without modifying the input scene.
Unsupported grouped, bound and corrupt imported selections remain outside
this initial editing scope. Regression fixtures are written but not run.

Svelte now offers font family, font size and text alignment for independent
unrotated auto-resizing text and validated reciprocal captions. Font metrics,
wrapping and resizing of labeled containers are delegated to the original
`redrawTextBoundingBox` and `Scene.mutateElement`, without a second layout
engine. Unsupported arrow-bound, rotated, grouped and fixed-size text remains
read-only until the original full text interaction path is adapted. Fixtures
are written but not run; no build/CI performed.

Native canvas now supports fitting all supported visible objects or the
current selection to the viewport via core `getCommonBounds` and
`zoomToFitBounds`. Svelte only converts pixel pan to/from Excalidraw's
scene-space scroll; the original viewport code owns bounds, zoom limits and
centering. Zoom fitting does not modify document state or undo history.
Fixtures were authored but not executed.

Svelte now exposes a crop-reset action for validated independent image
elements. It reuses the original `getUncroppedImageElement` and the common
`newElementWith` update path; no image positioning algorithm was copied.
Interactive crop handles and cropping arbitrary imported images still need
the original editor interaction lifecycle. The 80%-center-crop action now
calls original `cropElement` with decoded image dimensions. Fixture scenarios were authored
but not run.

Svelte history now captures Excalidraw's original `ElementsDelta` for
reversible, validated edits to existing elements with unchanged IDs and
fractional indices. It replays the core delta (including its binding repair)
on private copies, compares resulting element data against the known
snapshot, and only adopts it when the result is equivalent. Snapshot history
still safely handles insertions, deletions, z-order changes, malformed legacy
scenes, appState, binary files, and unknown extension fields. Pointer gestures
store their latest preview scene so the final transaction does not depend on
reactive prop timing. This is **partial history reuse**, not full parity
with React's Store and History. Tests/CI are not run.

Native Svelte now exposes all six Excalidraw alignment directions and
horizontal/vertical equal-gap distribution. The actions call the original
`alignElements` and `distributeElements` inside an isolated `Scene`.
The adapter also recognizes complete safe nested groups as one logical item
and reciprocal single-label boxes, using the original selectedGroupIds
semantics. Partial groups, foreign bindings and nested groups remain read-only.
Fixtures are authored but not executed.

Visible native resize/rotation marker positions and picking now use the
original `getTransformHandles` at the current canvas zoom. The prior
hand-calculated opposite-corner anchors are retained only for the guarded
cropped-raster fallback geometry. Fixtures authored but not executed.

The native layer controls can now move a complete validated flat group or
single reciprocal captioned box as one logical unit, using the original
`moveOneLeft`, `moveOneRight`, `moveAllLeft` and `moveAllRight`.
The UI rejects partial groups and non-contiguous legacy group ranges,
leaving them untouched for the full editor. Tests were authored but not run.

Whole linked-arrow groups can now be duplicated through Excalidraw's
`duplicateElement` and `fixDuplicatedBindingsAfterDuplication`; the
adapter revalidates the copied component before adopting it. Layer
reordering also accepts whole verified nested and linked groups.
Fixtures are present but unexecuted.

Validated closed groups may now carry a box caption and reciprocal arrow
links on the same box. `nativeReciprocalCaption` validates mixed
box/text/arrow relationships without weakening the guarded single-label
editor, and original core binding functions can now attach new arrows to
already-captioned safe boxes. The native adapter includes the caption as an internal
group member during grouping, duplication and deletion, while the original
core still owns movement and binding mutations. The one-label-only native editor remains guarded, but complete composite
groups now have a separate double-click text-edit action that delegates
caption measurement, box resize and arrow-point updates to the original
`redrawTextBoundingBox` and `updateBoundElements`. Unsupported empty-text
deletion and partial imported graphs remain no-ops. No separate text layout code is introduced.

Complete simple two-point arrow/box binding graphs can now be grouped and
dragged via Excalidraw's original `dragSelectedElements`. Svelte validates
the reciprocal relationship and keeps all referenced shapes within the
selection. Orphan, partial, foreign and mixed box-caption-arrow graphs still
fail closed. No independent routing or fixed-point geometry was added.

Whole nested groups made of boxes, unbound simple lines/arrows, image
rasters and reciprocal captions now expose resize/rotation handles. Their
geometry is delegated to Excalidraw's original `resizeMultipleElements`
and `transformElements`, followed by full ancestry and caption checks.
Complete **simple** arrow/box binding groups can now be resized and rotated by
the original multi-element transform algorithms, with postcondition checks on
group ancestry, reciprocal links, captions and untouched external elements.
Also includes groups with a single-ended simple bound arrow. Malformed
imports, linked elbows and partially selected graphs still fail
closed.
The safe-group guard also supports multiple connected simple arrows
sharing the same target when all reciprocal links remain inside the group.

Nested native groups can now be selected as complete outer units, duplicated, moved,
deleted, wrapped in a higher-level group, and ungrouped one outer level at a
time. Validation checks every member's ancestry, including reciprocal labels,
rejects malformed cross-parent references and singleton inner groups, and
delegates group-ID changes to Excalidraw's own `addToGroup` and
`removeFromSelectedGroups`. Individual editing inside nested groups still
requires the original group-editing interaction model; Svelte intentionally
selects only whole outer groups. Fixtures authored, not run.

Inside an active nested group-editing scope, single independent children
also expose native style and standalone typography controls. Property
mutations use original `newElementWith` and `redrawTextBoundingBox`, while
linked arrows, grouped labels and partially edited child groups retain
their conservative read-only restrictions.

Single inner-group boxes now expose the original `getTransformHandles`
geometry and can resize/rotate using `transformElements` in a separate
Scene transaction. Bound arrows and captions update via core, and every
group and reference is checked before results are accepted.

Double-clicking into a whole group now enters its original
`editingGroupId` hierarchy: immediate child groups remain atomic until
entered, while direct children can be selected and moved individually.
Escape or the toolbar button exits one level and restores parent selection.
Movement is still delegated to `dragSelectedElements` and the original
binding update logic, with closed-group revalidation. Transform handles for
individual bound/grouped children need a separate safe core bridge.

A native "Исправить связи" action now detects a limited, common imported
inconsistency: an ordinary arrow has a valid inside-binding to a box, but
that box lacks the corresponding reverse arrow reference. The original
`bindBindingElement` rebuilds the reciprocal links in one undoable core
transaction. Complex imports are never silently normalized; repair is an
explicit action and is rejected if any unrelated object changes.

The native editor now exposes interior segment handles for validated complex
orthogonal elbows (including imported fixedSegments and bound labels).
Dragging calls original `LinearElementEditor.moveFixedSegment`, and
Alt+click releases a fixed segment via `deleteFixedSegment`. Orphaned,
non-orthogonal and nonreciprocal imported data remain unchanged.

Svelte now has a gesture eraser. The editor collects native hit-tested
logical units, delegates actual deletion and binding cleanup to the original
core, and commits a whole stroke as one undo step. Invalid imported
relationships remain unchanged, rather than silently losing half their links.

The new "Угловая" drawing tool now routes freshly drawn two-point arrows
with Excalidraw's `updateElbowArrowPoints` conversion instead of a custom
orthogonal path generator. Existing ordinary arrows keep their own tool.

Frame drawing, wrapping selection and unwrapping now use original
`newFrameElement`, `getElementsInNewFrame`,
`addElementsToFrame` and `removeAllElementsFromFrame`. Moving a frame
delegates to original `dragSelectedElements`, which moves its children.
Frame naming is also editable through original `newElementWith`.
Single independent framed children are now selectable and movable without
detaching frame metadata. On pointer-up, an unbound individual root is
captured or released using the original frame hit-test and membership
algorithms. The entire drag and frame transfer share one undo transaction.
Partial groups and linked-arrow graph transfers remain unsupported.

Frame movement now passes through an additional source-level guard: the
original `dragSelectedElements` moves the frame and children, while Svelte
verifies that child membership, ancestry, captions, arrow target IDs and
external elements remain unchanged. Malformed partial framed groups fail
closed.

Native frames can now resize via original core corner handles, subject
to the strict condition that the original Excalidraw
`getElementsInResizingFrame` computes exactly the same children after the
gesture. Frames cannot be rotated; automatic adoption/expulsion of children
during resize still requires a full React-equivalent frame controller. The Svelte
canvas draws a lightweight frame outline, not its own membership engine.

The explicit "Исправить связи" action now also recognizes valid imported
orbit elbow bindings that lack the reverse box reference. The original
`bindBindingElement` restores the binding and triggers the original
orthogonal router; unsupported imports are never silently rewritten.
Both inside and orbit repair paths use one undo step for a click.

Lasso selection now calls the original React editor's pure polygon
selection function `getLassoSelectedElementIds`, with its original
contour, group and frame clipping rules. The Svelte pointer adapter only
records a world-space path and draws the preview; users can toggle
contain/overlap mode and Shift-add to selection.

The Svelte laser pointer now wraps Excalidraw's original
`@excalidraw/laser-pointer` stroke engine. The non-persistent trace
is rendered in canvas and disappears after release; it never modifies
the scene or the Undo stack. Collaborative laser streams and full
fade animation still belong to the React experience.

## Still custom: do not mistake these for parity

| Area | Existing core | Why not swapped wholesale yet |
| --- | --- | --- |
| Remaining complex arrow lifecycle (`native/bindings.ts`) | `packages/element/src/binding.ts`, `packages/element/src/elbowArrow.ts` | Isolated native elbow arrows now use `orbit` attachment, detachment and core rerouting on target translation, in addition to simple non-elbow `inside` bindings. Elbow fixed segments, mixed `inside`/`orbit` arrow references on one box, bound labels, grouping, mixed routes and arbitrary imported bindings still need parity. |
| Remaining resize and rotation | `packages/element/src/resizeElements.ts` | `resizeSingleElement`/`transformElements` now handle boxes, reciprocal text and uncropped embedded images; `resizeMultipleElements` handles flat groups of boxes, reciprocal captions, simple unbound two-point lines/arrows and uncropped embedded raster images. Cropped images, routed/bound linear groups, frames and unsupported imports still need parity work. |
| Drag interaction completeness | `packages/element/src/dragElements.ts`: `dragSelectedElements` | Basic native movement now delegates to this original engine with an isolated synthetic original-elements pointer snapshot; grid snapping, modifiers, nested frame interactions and the full React pointer state have not been ported. |
| Full selection semantics | `packages/element/src/selection.ts`, `packages/element/src/bounds.ts` | Marquee geometry now uses `elementsOverlappingBBox`; selection state, nested groups, locked elements and frames still need a real Svelte state adapter. |
| Undo/redo | `packages/element/src/store.ts` plus the original editor's history | The current snapshot history is intentionally independent, not granular Excalidraw history. |
| Rendering | `packages/element/src/shape.ts`, `renderElement.ts`, `packages/excalidraw/scene` | Boxes, lines, arrows and pressure-sensitive freehand now draw directly from core `ShapeCache` geometry; image placeholders, frames and selection overlays still need parity with the original renderer. |

## Required next refactor (before claiming parity)

1. Validate the already integrated `withNativeCoreScene` paths (deletion,
   dragging, resizing, rotating, simple arrow creation/reconnection) against
   the React editor with actual executed parity tests.
2. Extend the guarded `orbit` elbow path to fixed segments, mixed-mode
   bindings and bound labels, then address cropped raster and complex routed
   or externally linked group transforms after cross-editor parity tests.
3. Extend core fractional-index reconciliation beyond insertion and adopt
   original document-order and history transaction semantics.
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
Groups with cropped images, routed arrows and externally linked linear
members still use guarded native transforms until cross-editor parity
fixtures can run.

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

Native polyline topology editing now also reuses the original
`LinearElementEditor.addMidpoint` / `deletePoints` methods. The
`coreAdapter.ts` bridge supplies only the minimal React editor state
fields those methods inspect; all mutations occur on a private `Scene`.
The official `getSegmentMidPoint` supplies each segment marker's world
position. An Alt-click on the selected line's midpoint marker inserts one
vertex; Alt-click on an internal vertex deletes it. The Svelte toolbar
shows the shortcut when an eligible line/arrow is selected.
Every surviving world-space vertex, the element type, foreign object
identity, metadata and the 2–128-point limit are checked before adopting a
mutation. First and last vertices cannot be deleted. Unsupported polygon,
bound, grouped, elbow and malformed imported paths remain read-only.
Regression fixtures for insertion, deletion, rotation, undo/redo, no-op
gestures and corrupt imports were authored **without execution**.

The native Svelte editor now offers **core-routed unbound elbow arrows**.
A toolbar button converts a selected eligible two-point arrow to an elbow
path. It mirrors Excalidraw's arrow-type action by retaining the global
endpoints, clearing roundness, resetting rotation, and invoking the original
`updateElbowArrowPoints` route engine instead of constructing bends.
Selected elbow arrows expose only their two endpoint markers; dragging
them through `LinearElementEditor.movePoints` triggers the same core
router via `Scene.mutateElement`. The input and output are checked for
finite, orthogonal segments, preserved endpoints and metadata, no mutated
foreign elements, and the absence of orphan references. This path
deliberately excludes bindings (which require orbit semantics), fixed
segments, labels, nested groups, locked elements and complex imports.
Conversion, route drag, roundtrip, Undo/Redo and unsafe-import regression
fixtures are written **but not executed**.

Native elbow endpoint drags can now acquire or release **real
`orbit` bindings** to standalone rectangles, ellipses and diamonds. The
binding guard checks source and destination reciprocals (including original
`boundElements` references), orthogonal segments, finite normalized fixed
points, locked/grouped/frame state, and all external references. Unlike
ordinary `inside` attachments, the adapter delegates snapping and
fixed-point computation to core `bindBindingElement` in orbit mode; it
uses `unbindBindingElement` for detachment and `Scene.mutateElement` with
`updateElbowArrowPoints` for recalculating the route. No hand-made orbit
ratios or bend points are committed.

The Svelte selection UI recognizes valid orbit endpoints, and ordinary
core `dragSelectedElements` moves a linked box and invokes the original
`updateBoundElements` flow for its arrow. A postflight check rejects
transactions that lose any recognized reciprocal elbow relationship.
Resizing/rotating an orbit-linked box is intentionally disabled pending
cross-editor parity. The safe policy permits up to 16 validated orbit-arrow
references per target and **no other box labels, inside-mode links, pinned
segments or foreign references**. It does not claim general elbow-arrow
parity. Regression fixtures cover
connection, retargeting, disconnection, target movement, deletion, undo/redo
and invalid imports, **written but not executed**.

A box may now serve as an **orbit target for multiple routed elbows**
without replacing its existing reciprocal arrow references. The native
binding guard walks the connected component of shared targets and arrows
iteratively (without recursively invoking `isSafeBoundBox`), validating
every forward `orbit` endpoint, every reverse `boundElements` entry,
unique references, orthogonal unlocked arrows, ungrouped targets, and
absence of orphan/foreign text or arrow references. Core
`bindBindingElement`, `unbindBindingElement` and `dragSelectedElements`
still own attachment, detachment and rerouting; no native bend geometry
was added. A max of 16 orbit references per box keeps this initial
support conservative. Existing captions, ordinary `inside` bindings,
fixed segments and malformed imports remain excluded. Regression
fixtures for two arrows sharing a box, dragging, rerouting, selective
retargeting/deletion, undo/redo, JSON roundtrip, duplicate reverse IDs
and malformed siblings were authored **without executing tests**.

Native flat-group scaling and rotation now also delegate **mixed boxes and
unbound two-point lines/arrows** to `resizeMultipleElements` and
`transformElements` in the same private Excalidraw `Scene`. The original
`rescalePointsInElement` and group rotation path own the local linear points;
the Svelte layer no longer hand-scales those points in this safe subset.
Group selection must be complete, with normalized linear extents, no
`fixedSegments`, no elbow or polygon paths, no external bindings, and only
fully reciprocal caption links. The postcondition checks that linear point
ratios and endpoint order survive a uniform scale, arrowhead metadata is
retained, reciprocal labels remain fitted, and foreign elements are unchanged.
Existing images and unsupported/complex group members stay on the guarded
legacy transform path. Regression fixtures cover mixed-group resize/rotate,
reversed linear paths, box captions, undo/redo and orphan imported bindings.
**These tests are authored but have not been executed.**

Mixed flat groups of **uncropped embedded raster images** and eligible
boxes/straight arrows now also invoke the original group
`resizeMultipleElements` / `transformElements` algorithms in the
isolated Excalidraw `Scene`. This reuses the same raster checks as the
single-image adapter, permitting a complete one-level group but rejecting
missing/remote file data, invalid flip scale, crop metadata, locks,
frames and any orphan or foreign bindings. The postcondition explicitly
checks file ID, status, null crop, unchanged flip signs, aspect ratio,
custom data, group membership and unchanged unrelated elements. Images
with non-null crop deliberately stay on the guarded legacy path; their
natural-dimension coordinates are never rewritten by the core group
adapter. Regression fixtures cover mixed image/box/reversed-arrow
resize, image+bound-caption rotation, cropped legacy fallback, malformed
flip imports, external orphan links, file preservation, scene roundtrip
and Undo/Redo. **The tests have been authored but not executed.**

The clipboard's maximum element count is shared between copy and paste, so
cutting 1001 or more elements no longer deletes content that cannot be pasted
back. A regression fixture covers this destructive-mismatch case.

**None of the newly authored tests or CI workflows have been executed.**
These imports and parity checks must be validated before release.

Native Svelte rendering of rectangles, ellipses, diamonds, lines and arrows
now draws the **original Excalidraw ShapeCache drawables** using the
same local-coordinate transform and absolute center as the core renderer.
This removes the native duplicate RoughJS geometry and the one-off arrowhead
formula. Core owns rounded corners, seed/roughness, dashed/dotted strokes,
curved/routed line shapes and supported start/end arrowhead variants.
Freehand now also uses the core SVG fill path and perfect-freehand outline,
including pressure-sensitive strokes and closed-loop rough fills. Text,
images, clipping and interaction overlays remain on native paths. **No tests, build or CI were executed.**

Text painting is now shared with the original `renderElement.ts` code:
`paintTextElementOnCanvas` was extracted without changing its glyph,
multiline, baseline, text-alignment or RTL behavior. The Svelte adapter
provides only the scene transform for standalone text and validated
reciprocal box captions. The former native `paintNativeText` is no
longer used by `NativeEditor.svelte`; existing compatibility helpers
are retained for now. No tests or build were executed.

Embedded supported raster painting now calls the extracted `paintImageElementOnCanvas`
directly from the original `renderElement.ts` implementation. This retains
the core crop source rectangle, optional image roundness clipping and
theme-aware image drawing. Svelte only supplies the current decoded raster
and the same position/flip/angle transform that the React export path uses.
Missing or loading images still use the native dashed placeholder. The
legacy `paintNativeImage` remains exported for compatibility tests but is
no longer called by `NativeEditor.svelte`. No tests/build/CI executed.

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
