<script lang="ts">
  import NativeEditor from "./NativeEditor.svelte";
  import { isNonDeletedElement } from "@excalidraw/element";

  import type { BinaryFiles, ExportSceneData } from "@excalidraw/excalidraw";
  import {
    blankScene,
    parseScene,
    serializeScene,
    type SceneFile,
  } from "./native/scene";

  let theme = $state<"light" | "dark">("light");
  let mode = $state<"native" | "full">("native");
  let scene = $state.raw<SceneFile>(blankScene());
  let documentEpoch = $state(0);
  let status = $state("");
  let exportingImage = $state(false);
  let input: HTMLInputElement;
  // Import the React code only on demand, when the user opens full Excalidraw.
  let FullEditor = $state<any>(null);

  function sceneChanged(next: SceneFile) {
    scene = next;
  }

  async function switchMode(next: "native" | "full") {
    if (next === "native") {
      mode = next;
      return;
    }

    mode = "full";
    if (!FullEditor) {
      try {
        const module = await import("./ExcalidrawEditor.svelte");
        FullEditor = module.default;
      } catch (error) {
        status = error instanceof Error ? error.message : "Не удалось загрузить полный редактор.";
        mode = "native";
      }
    }
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function saveFile() {
    downloadBlob(
      new Blob([serializeScene(scene)], {
        type: "application/vnd.excalidraw+json",
      }),
      "drawing.excalidraw",
    );
    status = "Файл сохранён.";
  }

  /**
   * Export from the original Excalidraw renderer, not the native Svelte
   * canvas. Import the export implementation on demand and never mount the
   * React editor. Its image/font/clip/layout path remains authoritative.
   */
  async function exportImage(format: "png" | "svg") {
    if (exportingImage) {
      return;
    }
    exportingImage = true;
    status = "";
    try {
      const { exportScene } = await import("@excalidraw/excalidraw");
      const bg = typeof scene.appState.viewBackgroundColor === "string"
        ? scene.appState.viewBackgroundColor
        : "#ffffff";
      const data: ExportSceneData = {
        elements: scene.elements.filter(isNonDeletedElement),
        appState: { viewBackgroundColor: bg } as ExportSceneData["appState"],
        files: scene.files as unknown as BinaryFiles,
      };
      if (format === "png") {
        const blob = await exportScene({
          type: "png",
          data,
          config: {
            canvasBackgroundColor: bg,
            theme,
            scale: 2,
            embedScene: true,
          },
        });
        downloadBlob(blob, "drawing.png");
      } else {
        const svg = await exportScene({
          type: "svg",
          data,
          config: {
            canvasBackgroundColor: bg,
            theme,
            embedScene: true,
          },
        });
        downloadBlob(
          new Blob([new XMLSerializer().serializeToString(svg)], {
            type: "image/svg+xml;charset=utf-8",
          }),
          "drawing.svg",
        );
      }
      status = `Экспорт ${format.toUpperCase()} выполнен.`;
    } catch (error) {
      status = error instanceof Error ? error.message : "Не удалось экспортировать изображение.";
    } finally {
      exportingImage = false;
    }
  }

  async function importFile(event: Event) {
    const element = event.currentTarget as HTMLInputElement;
    const file = element.files?.[0];
    if (!file) {
      return;
    }
    try {
      const imported = parseScene(await file.text());
      scene = imported;
      // Reset native undo history and recreate a loaded React editor.
      documentEpoch++;
      status = `Открыт файл: ${file.name}`;
    } catch (error) {
      status = error instanceof Error ? error.message : "Ошибка импорта.";
    } finally {
      element.value = "";
    }
  }
</script>

<div class="app-shell">
  <header class="toolbar">
    <div class="identity">
      <strong>Excalidraw <span class="subtitle">/ Svelte 5</span></strong>
      <span class="indicator">
        {mode === "native" ? "Нативный Canvas" : "Полный редактор (React)"}
      </span>
    </div>

    <div class="actions">
      <input
        class="file-input"
        type="file"
        accept=".excalidraw,application/vnd.excalidraw+json"
        bind:this={input}
        onchange={importFile}
        aria-label="Импортировать .excalidraw"
      />
      <button onclick={() => input.click()}>Открыть</button>
      <button onclick={saveFile}>Сохранить</button>
      <button disabled={exportingImage} onclick={() => void exportImage("png")} title="Оригинальный экспорт Excalidraw в PNG">
        PNG
      </button>
      <button disabled={exportingImage} onclick={() => void exportImage("svg")} title="Оригинальный экспорт Excalidraw в SVG">
        SVG
      </button>
      <button onclick={() => (theme = theme === "light" ? "dark" : "light")}>
        {theme === "light" ? "Тёмная тема" : "Светлая тема"}
      </button>
      <div class="mode-buttons" role="group" aria-label="Выбор редактора">
        <button
          class:chosen={mode === "native"}
          aria-pressed={mode === "native"}
          onclick={() => switchMode("native")}
        >
          Svelte
        </button>
        <button
          class:chosen={mode === "full"}
          aria-pressed={mode === "full"}
          onclick={() => switchMode("full")}
        >
          Полный
        </button>
      </div>
    </div>
  </header>

  <main class="canvas-container">
    {#if mode === "native"}
      <NativeEditor
        {scene}
        {theme}
        {documentEpoch}
        onChange={sceneChanged}
      />
    {:else if FullEditor}
      {#key documentEpoch}
        <FullEditor
          {theme}
          initialScene={scene}
          onSceneChange={sceneChanged}
        />
      {/key}
    {:else}
      <p class="loading">Загрузка полного редактора…</p>
    {/if}
  </main>

  {#if status}
    <p class="status" role="status">{status}</p>
  {/if}
</div>
