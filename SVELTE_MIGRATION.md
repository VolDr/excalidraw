# Svelte 5 migration strategy

## Current architecture

This repository includes a React 19 web application in `excalidraw-app/`
and the React-based `@excalidraw/excalidraw` editor in
`packages/excalidraw/`. The latter includes React components, hooks,
context, and Jotai state; its editor APIs are not framework-neutral.

The separate `@excalidraw/common`, `@excalidraw/element`,
`@excalidraw/math`, and `@excalidraw/fractional-indexing` packages are
the better starting point for extracting framework-independent domain logic.
Do not assume every module in those packages is browser-independent without
auditing imports.

## Phases

1. **Svelte host (this branch).** Add `examples/with-svelte/` with a native
   Svelte 5 toolbar and the existing editor mounted behind a narrow React
   interoperability boundary. This validates scene imports/exports and a
   stable Svelte-to-editor API while keeping current editor functionality.
2. **Framework-independent state.** Extract document state, selection,
   history, command execution, and subscriptions into a TS controller with
   no React hooks or Jotai. Freeze typed contracts and add parity tests.
3. **Canvas/pointer engine.** Isolate rendering, hit testing, drag, pinch,
   keyboard shortcuts, and text editing behind browser-neutral interfaces
   where possible. Preserve scene JSON compatibility.
4. **Native Svelte editor.** Move editor toolbars, menus, dialogs, panels,
   selection UI, and tool state to Svelte 5. Replace the React adapter with
   the extracted engine as each feature reaches parity.
5. **Full app migration.** Port local-first persistence, multiplayer,
   sharing, PWA, routing, and localization from `excalidraw-app/`.
   Move builds and tests only after end-to-end parity is demonstrated.
6. **Remove React.** Delete React/React DOM/Jotai only when no runtime
   consumers remain, after checking the transitive dependency tree.

## Non-negotiable parity

- Open/save `.excalidraw`, including images and backward compatibility.
- Shape creation, selection, drag/resize/rotate, arrows and bindings.
- Undo/redo and keyboard, pointer, touch, and stylus interactions.
- PNG/SVG/export, fonts, themes, localization, performance.
- Collaboration, encrypted sharing, offline support, accessibility.

Do not drop existing `excalidraw-app/` or the React package while native
Svelte functionality is incomplete. Preserve the MIT attribution/license.
