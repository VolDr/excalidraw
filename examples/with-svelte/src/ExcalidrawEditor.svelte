<script lang="ts">
  import { onMount } from "svelte";
  import { createElement } from "react";
  import { createRoot, type Root } from "react-dom/client";
  import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
  import type {
    AppState,
    BinaryFiles,
    ExcalidrawInitialDataState,
  } from "@excalidraw/excalidraw/types";
  import type { ExcalidrawElement } from "@excalidraw/element/types";
  import type { SceneFile } from "./native/scene";
  import { parseScene } from "./native/scene";

  type Props = {
    theme: "light" | "dark";
    initialScene: SceneFile;
    onSceneChange: (scene: SceneFile) => void;
  };

  let { theme, initialScene, onSceneChange }: Props = $props();
  let container: HTMLDivElement;
  let reactRoot: Root | null = null;

  // Initial data is only captured at mount; React's component keeps its own
  // scene between theme updates. Changes flow back to Svelte as JSON snapshots.
  const initialData = {
    elements: initialScene.elements,
    appState: initialScene.appState,
    files: initialScene.files,
  } as unknown as ExcalidrawInitialDataState;

  function handleChange(
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) {
    const json = serializeAsJSON(elements, appState, files, "local");
    onSceneChange(parseScene(json));
  }

  function renderEditor(currentTheme: Props["theme"]) {
    reactRoot?.render(createElement(Excalidraw, {
      initialData,
      theme: currentTheme,
      langCode: "ru",
      onChange: handleChange,
    }));
  }

  onMount(() => {
    reactRoot = createRoot(container);
    renderEditor(theme);
    return () => {
      reactRoot?.unmount();
      reactRoot = null;
    };
  });

  $effect(() => {
    const nextTheme = theme;
    if (reactRoot) {
      renderEditor(nextTheme);
    }
  });
</script>

<div class="editor-mount" bind:this={container}></div>

<style>
  .editor-mount {
    width: 100%;
    height: 100%;
    min-height: 0;
    min-width: 0;
  }
</style>
