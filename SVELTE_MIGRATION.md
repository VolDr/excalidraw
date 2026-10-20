# Svelte 5 migration strategy

## Current state (phase 2, partial)

`examples/with-svelte` now boots a Svelte 5 application with a **native** Rough.js/Canvas 2D vertical slice for shapes, unbound text, freehand, selection, rotation/resize, scene JSON handling, and undo history. The user can switch to the existing React editor for the unported functionality. The React editor loads lazily on demand.

Core Excalidraw remains a React/Jotai application and library. The new native editor is **not feature-complete** or an equivalent drop-in replacement.

## Architecture

- `packages/excalidraw/`: original React editor. Untouched.
- `excalidraw-app/`: original production site. Untouched.
- `packages/common`, `packages/element`, `packages/math`: reusable existing geometry and data types, subject to per-module dependency audits.
- `examples/with-svelte/src/native/scene.ts`: framework-independent scene serialization, basic elements, selection picking, transform helpers.
- `examples/with-svelte/src/native/history.ts`: undo/redo snapshots.
- `examples/with-svelte/src/NativeEditor.svelte`: new Svelte UI, interactions, rough canvas painting, text editor and pointer handling.
- `examples/with-svelte/src/ExcalidrawEditor.svelte`: temporary React interoperability boundary.

## Next steps

1. Run `check`, tests, build and browser smoke checks (unverified).
2. Extract/reuse precise Excalidraw rendering, element geometry and transform routines (text, arrows, bindings and rotated objects).
3. Port rich selection, resize/rotate, keyboard/pointer/touch gestures, clipboard, text editing, freehand, images, libraries and menus.
4. Replace snapshot history with granular Excalidraw-compatible history.
5. Port the site's local-first persistence, collaboration, end-to-end encryption, share links and PWA functions.
6. Compare saved documents between old and new implementations and add automated end-to-end parity tests.
7. Remove the React adapter and runtime dependencies only after parity. Preserve MIT licensing and project notices.

## Non-negotiable parity

- No data loss for imported `.excalidraw` files, including embedded images.
- Import/export PNG, SVG and JSON when feature parity is claimed.
- Full shape edit/selection/transform, arrow bindings and frame operations.
- Keyboard, mouse, touch and stylus interaction correctness.
- Collaboration, encrypted sharing, offline, accessibility and localization.
