<script lang="ts">
  import { onMount } from "svelte";
  import { createElement } from "react";
  import { createRoot, type Root } from "react-dom/client";
  import { Excalidraw } from "@excalidraw/excalidraw";
  import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

  type Props = {
    theme: "light" | "dark";
    onReady: (api: ExcalidrawImperativeAPI | null) => void;
  };

  let { theme, onReady }: Props = $props();

  let container: HTMLDivElement;
  let reactRoot: Root | null = null;

  function renderEditor(currentTheme: Props["theme"], callback: Props["onReady"]) {
    reactRoot?.render(
      createElement(Excalidraw, {
        theme: currentTheme,
        onExcalidrawAPI: callback,
        langCode: "ru",
      }),
    );
  }

  onMount(() => {
    reactRoot = createRoot(container);
    renderEditor(theme, onReady);

    return () => {
      reactRoot?.unmount();
      reactRoot = null;
      onReady(null);
    };
  });

  // Only host props are reactive in Svelte. The React editor keeps its own
  // scene, actions, history, and internal state across these renders.
  $effect(() => {
    const nextTheme = theme;
    const callback = onReady;
    if (reactRoot) {
      renderEditor(nextTheme, callback);
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
