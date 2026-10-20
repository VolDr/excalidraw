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

- Draw rectangle, ellipse, diamond, line and arrow using the Canvas 2D API and the same Rough.js renderer family as Excalidraw.
- Select and drag basic shapes, soft-delete selected shapes, and undo/redo.
- Pan using the hand tool or mouse wheel, and zoom using Ctrl+wheel.
- Use keyboard: V (selection), R (rectangle), Delete, Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y.
- Import and export native `.excalidraw` JSON. Preserve unknown elements and embedded image data rather than dropping them from the document.
- Toggle Svelte/React editing modes while carrying scene JSON between them.
- Svelte theme and file toolbar; React chunk loads only when requested.

## Known limitations

- Native mode does not render images, freehand, text, frames, rotated geometry, bindings, labels or advanced line geometry yet. It shows an explicit warning for unsupported element types, preserves their data, and provides a full React-editor fallback. Supported elements with complex geometry/rotation may be drawn approximately.
- It does not have the original editor's collaboration, PWA, persistence, full keyboard shortcuts, tool and selection semantics, PNG/SVG export, or touch gesture parity. History remains separate across mode switches.
- The React fallback is **not** a migrated component; the application still declares React dependencies and shares the `@excalidraw/excalidraw` package.
- Embedded scene data in PNG/SVG is not supported by this file importer.
- The native scene renderer and input engine are intentionally an early compatibility slice, not a drop-in alternative to Excalidraw.

## Verification

`src/native/scene.test.ts` contains round-trip, move/undo and geometry unit tests. Use the commands above after dependency installation. Browser smoke tests have not yet been run in the authoring environment.
