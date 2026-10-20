<script lang="ts">
  import {
    CaptureUpdateAction,
    loadFromBlob,
    serializeAsJSON,
  } from "@excalidraw/excalidraw";
  import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

  import ExcalidrawEditor from "./ExcalidrawEditor.svelte";

  let theme = $state<"light" | "dark">("light");
  // The editor API is a complex external object: never proxy it with $state.
  let editorApi = $state.raw<ExcalidrawImperativeAPI | null>(null);
  let message = $state("");
  let fileInput: HTMLInputElement;

  function saveFile() {
    if (!editorApi) {
      return;
    }

    const content = serializeAsJSON(
      editorApi.getSceneElements(),
      editorApi.getAppState(),
      editorApi.getFiles(),
      "local",
    );
    const blob = new Blob([content], {
      type: "application/vnd.excalidraw+json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "drawing.excalidraw";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    message = "Файл сохранён.";
  }

  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    const api = editorApi;

    if (!file || !api) {
      input.value = "";
      return;
    }

    try {
      const scene = await loadFromBlob(
        file,
        api.getAppState(),
        api.getSceneElements(),
      );
      api.addFiles(Object.values(scene.files ?? {}));
      api.updateScene({
        elements: scene.elements,
        appState: scene.appState,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      message = `Импортирован файл: ${file.name}`;
    } catch (error) {
      message = error instanceof Error ? error.message : "Не удалось открыть файл.";
    } finally {
      input.value = "";
    }
  }
</script>

<div class="app-shell">
  <header class="toolbar">
    <strong>Excalidraw <span class="subtitle">/ Svelte</span></strong>

    <div class="actions">
      <input
        class="file-input"
        type="file"
        accept=".excalidraw,application/vnd.excalidraw+json"
        bind:this={fileInput}
        onchange={importFile}
        aria-label="Импортировать .excalidraw"
      />
      <button disabled={!editorApi} onclick={() => fileInput.click()}>
        Открыть
      </button>
      <button disabled={!editorApi} onclick={saveFile}>
        Сохранить
      </button>
      <button
        aria-label="Переключить тему"
        aria-pressed={theme === "dark"}
        onclick={() => (theme = theme === "light" ? "dark" : "light")}
      >
        {theme === "light" ? "Тёмная тема" : "Светлая тема"}
      </button>
    </div>
  </header>

  <main class="canvas-container">
    <ExcalidrawEditor {theme} onReady={(instance) => (editorApi = instance)} />
  </main>

  {#if message}
    <p class="status" role="status">{message}</p>
  {/if}
</div>
