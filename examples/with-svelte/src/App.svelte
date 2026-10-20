<script lang="ts">
  import NativeEditor from "./NativeEditor.svelte";
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

  function saveFile() {
    const blob = new Blob([serializeScene(scene)], {
      type: "application/vnd.excalidraw+json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "drawing.excalidraw";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status = "Файл сохранён.";
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
