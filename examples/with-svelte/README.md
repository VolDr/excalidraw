# Excalidraw in Svelte 5 — migration phase 1

This is a **Svelte 5 host application with a temporary React editor adapter**,
not a complete rewrite of Excalidraw.

## Run

From the monorepo root:

```sh
yarn install
yarn build:packages
yarn --cwd examples/with-svelte dev
```

Then open http://localhost:3007.

The project uses the built workspace `@excalidraw/excalidraw` distribution
and consumes its exported CSS. Rebuild the packages after modifying core code.

## Implemented

- Svelte 5 application entrypoint and responsive toolbar.
- React editor mounted as an isolated leaf via `react-dom/client`.
- Svelte-driven light/dark theme using a stable React root.
- Native Excalidraw JSON import/export, including embedded image files.

## Not migrated yet

- The core editor and its React/Jotai state management.
- The original full site's collaboration, local-first autosave, PWA,
  share links, and other app-level features.
- Native Svelte editor tools, dialogs, toolbars, and canvas interactions.

The adapter is deliberately explicit: do not describe this demo as
“React-free”. See `../../SVELTE_MIGRATION.md` for the migration sequence.

## Verification

Run `yarn --cwd examples/with-svelte check` and
`yarn --cwd examples/with-svelte build` after installing dependencies.
