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
- Import and export native `.excalidraw` JSON. Render embedded raster PNG/JPEG/GIF/WebP images (rotation, flipping, crop and opacity), and insert new raster images in native mode. Keep image data intact when moving, deleting, duplicating or saving. Unsupported formats remain in the file.
- Toggle Svelte/React editing modes while carrying scene JSON between them.
- Svelte theme and file toolbar; React chunk loads only when requested.

## Known limitations

- Native mode still does not render SVG images, frames, advanced bound text, advanced bindings, labels or complex multi-point and elbow arrow geometry yet. It shows an explicit warning for unsupported element types, preserves their data, and provides a full React-editor fallback. Supported elements with complex geometry/rotation may be drawn approximately.
- It does not have the original editor's collaboration, PWA, persistence, full keyboard shortcuts, tool and selection semantics, PNG/SVG export, or touch gesture parity. History remains separate across mode switches.
- The React fallback is **not** a migrated component; the application still declares React dependencies and shares the `@excalidraw/excalidraw` package.
- Embedded scene data in PNG/SVG is not supported by this file importer.
- The native scene renderer and input engine are intentionally an early compatibility slice, not a drop-in alternative to Excalidraw.

## Verification

`src/native/scene.test.ts` contains round-trip, move/undo and geometry unit tests. Use the commands above after dependency installation. Browser smoke tests have not yet been run in the authoring environment.
