# Svelte 5 migration — runnable editor slice

The primary editor in this example is a **native Svelte 5 Canvas** with a small framework-independent scene/undo core. The old React Excalidraw editor is retained as an explicitly marked, lazily imported fallback under the **Полный** button. This is not yet a complete native migration.

## Development

From the monorepo root:

```sh
yarn install
yarn build:packages
yarn --cwd examples/with-svelte typecheck
yarn --cwd examples/with-svelte test
yarn --cwd examples/with-svelte build
yarn --cwd examples/with-svelte dev
```

Open http://localhost:3007.

## Native Svelte features

- Draw rectangle, ellipse, diamond, line, arrow and pressure-sampled freehand strokes using the Canvas 2D API and the same Rough.js renderer family as Excalidraw.
- Add/edit plain text through a Svelte textarea (double-click text to edit); select, drag and delete shapes with undo/redo.
- Pan using the hand tool or mouse wheel, and zoom using Ctrl+wheel.
- Ctrl+G groups selected independent shapes; Ctrl+Shift+G ungroups a complete flat group. Clicking one member selects the whole group; group movement, deletion and Ctrl+D duplication are supported.
- Shift-click or drag a selection marquee to select multiple independent objects; left-to-right marquee intersects, right-to-left fully encloses. Drag, delete or use arrow keys to move the selection (Shift+arrows moves by 10). Ctrl+A selects all safely movable objects. Ctrl+D duplicates the selection.
- New straight two-point arrows attach to independent rectangles/ellipses/diamonds, follow their movement, rotation and resizing, and can be reconnected or detached by dragging an endpoint. Reciprocal Excalidraw bindings are preserved. Removing a linked arrow or its target cleans the references.
- Drag end handles to edit simple unbound, two-point lines and arrows. Use keyboard: V (selection), R (rectangle), Delete, Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y.
- Import/export `.excalidraw` JSON and embed raster PNG/JPEG/GIF/WebP; preserve crop, rotation, reflection and opacity. Select and drag corner/rotation handles to resize proportionally and rotate images; use horizontal/vertical flip toolbar buttons. Move, delete, duplicate and save image elements without altering embedded image data. Unsupported formats remain in the file.
- Ctrl+D now duplicates an independent labeled box together with its label, allocating fresh IDs for both elements and remapping reciprocal links. Both original and copy can be moved or deleted without changing the other. Imported mixed/unsafe bindings are never duplicated in native mode.
- Imported, reciprocal text labels on independent rectangles, ellipses and diamonds now render natively; their official alignment/wrapping and placement follow moves, rotation and resizing, and deletion removes the label with its box. Malformed, nested, arrow-bound and advanced labels remain reserved for the full React editor. Double-click an unlocked, ungrouped rectangle, ellipse or diamond to add/edit its single label; clearing the text detaches the label, while a long label grows its box. Changes are undoable. Only unrotated boxes support the inline editing overlay; malformed, nested, arrow-bound and complex imported labels stay in React.
- Text drawing now uses Excalidraw font baseline/line-height and left/center/right alignment. Existing non-bound text editing preserves alignment anchors; fixed-width text is rewrapped while preserving original text. The CI smoke test exercises drawing, duplication, undo, text and JSON export in headless Chrome.
- Toggle Svelte/React editing modes while carrying scene JSON between them.
- Svelte theme and file toolbar; React chunk loads only when requested.

## Known limitations

- Native mode still does not render SVG images, frames, advanced bound text, advanced bindings, arrow labels or complex multi-point and elbow arrow geometry yet. Crop editing is not yet available; resizing images retains the existing aspect ratio and crop. It shows an explicit warning for unsupported element types, preserves their data, and provides a full React-editor fallback. Supported elements with complex geometry/rotation may be drawn approximately.
- It does not have the original editor's collaboration, PWA, persistence, full keyboard shortcuts, tool and selection semantics, PNG/SVG export, or touch gesture parity. History remains separate across mode switches.
- The React fallback is **not** a migrated component; the application still declares React dependencies and shares the `@excalidraw/excalidraw` package.
- Embedded scene data in PNG/SVG is not supported by this file importer.
- The native scene renderer and input engine are intentionally an early compatibility slice, not a drop-in alternative to Excalidraw.

## Verification

`src/native/scene.test.ts` contains round-trip, move/undo and geometry unit tests. Use the commands above after dependency installation. Browser smoke tests have not yet been run in the authoring environment.
