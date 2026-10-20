<script lang="ts">
  import { onMount } from "svelte";
  import rough from "roughjs/bin/rough";

  import { getFontString } from "@excalidraw/common";

  import type { ExcalidrawElement } from "@excalidraw/element/types";
  import { SceneHistory } from "./native/history";
  import {
    createShape,
    createFreeDraw,
    deleteById,
    elementBounds,
    isNativeShape,
    moveById,
    pickElement,
    unsupportedCount,
    type NativeShape,
    type NativeTool,
    type Point,
    type SceneFile,
  } from "./native/scene";

  type Props = {
    scene: SceneFile;
    theme: "light" | "dark";
    documentEpoch: number;
    onChange: (scene: SceneFile) => void;
  };

  let { scene, theme, documentEpoch, onChange }: Props = $props();

  let canvas: HTMLCanvasElement;
  let viewport: HTMLDivElement;

  let tool = $state<NativeTool>("selection");
  let selectedId = $state<string | null>(null);
  let preview = $state.raw<ExcalidrawElement | null>(null);
  let zoom = $state(1);
  let pan = $state<Point>({ x: 0, y: 0 });
  let viewSize = $state<Point>({ x: 0, y: 0 });
  let undoAvailable = $state(false);
  let redoAvailable = $state(false);
  let unsupported = $derived(unsupportedCount(scene));

  const history = new SceneHistory();

  type Gesture = {
    pointerId: number;
    action: "draw" | "move" | "pan" | "free";
    start: Point;
    original: SceneFile;
    initialPan: Point;
    id: string | null;
    draft: ExcalidrawElement | null;
    changed: boolean;
    points: Point[];
    pressures: number[];
  };
  let gesture: Gesture | null = null;

  // Replace the undo stack after an explicit file import or editor reset.
  $effect(() => {
    documentEpoch;
    history.clear();
    selectedId = null;
    undoAvailable = false;
    redoAvailable = false;
  });

  function refreshHistory() {
    undoAvailable = history.canUndo;
    redoAvailable = history.canRedo;
  }

  function commit(previous: SceneFile, next: SceneFile) {
    history.commit(previous);
    onChange(next);
    refreshHistory();
  }

  function undo() {
    if (history.canUndo) {
      onChange(history.undo(scene));
      refreshHistory();
      selectedId = null;
    }
  }

  function redo() {
    if (history.canRedo) {
      onChange(history.redo(scene));
      refreshHistory();
      selectedId = null;
    }
  }

  function getPoint(event: PointerEvent): Point {
    const rect = viewport.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - pan.x) / zoom,
      y: (event.clientY - rect.top - pan.y) / zoom,
    };
  }

  function getScreenPoint(event: PointerEvent): Point {
    const rect = viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function redraw() {
    if (!canvas || viewSize.x <= 0 || viewSize.y <= 0) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const w = viewSize.x;
    const h = viewSize.y;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const pixelWidth = Math.round(w * dpr);
    const pixelHeight = Math.round(h * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = theme === "dark"
      ? "#1e1e1e"
      : (typeof scene.appState.viewBackgroundColor === "string"
        ? scene.appState.viewBackgroundColor : "#ffffff");
    ctx.fillRect(0, 0, w, h);

    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * pan.x, dpr * pan.y);
    const sketch = rough.canvas(canvas);

    const draw = (element: ExcalidrawElement) => {
      if (!isNativeShape(element)) {
        return;
      }
      const { x, y, width, height } = elementBounds(element);
      const opts = {
        seed: element.seed,
        roughness: element.roughness,
        stroke: element.strokeColor,
        strokeWidth: element.strokeWidth,
        fill: element.backgroundColor === "transparent"
          ? undefined
          : element.backgroundColor,
        fillStyle: element.fillStyle,
      };
      ctx.save();
      ctx.globalAlpha = element.opacity / 100;
      if (element.angle) {
        const cx = x + width / 2;
        const cy = y + height / 2;
        ctx.translate(cx, cy);
        ctx.rotate(element.angle);
        ctx.translate(-cx, -cy);
      }

      switch (element.type) {
        case "rectangle":
          sketch.rectangle(x, y, width, height, opts);
          break;
        case "ellipse":
          sketch.ellipse(x + width / 2, y + height / 2, width, height, opts);
          break;
        case "diamond":
          sketch.polygon([
            [x + width / 2, y],
            [x + width, y + height / 2],
            [x + width / 2, y + height],
            [x, y + height / 2],
          ], opts);
          break;
        case "text": {
          ctx.fillStyle = element.strokeColor;
          ctx.font = getFontString({
            fontSize: element.fontSize,
            fontFamily: element.fontFamily,
          });
          ctx.textBaseline = "top";
          for (const [i, line] of element.text.split("\\n").entries()) {
            ctx.fillText(line, x, y + i * element.fontSize * element.lineHeight);
          }
          break;
        }
        case "freedraw": {
          const points = element.points.map((p) => [element.x + p[0], element.y + p[1]] as const);
          if (points.length) {
            ctx.beginPath();
            ctx.strokeStyle = element.strokeColor;
            ctx.lineWidth = element.strokeWidth * 2;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.moveTo(points[0][0], points[0][1]);
            for (const point of points.slice(1)) {
              ctx.lineTo(point[0], point[1]);
            }
            if (points.length === 1) {
              ctx.lineTo(points[0][0] + 0.01, points[0][1]);
            }
            ctx.stroke();
          }
          break;
        }
        case "line":
        case "arrow": {
          const pts = element.points.map((p) =>
            [element.x + p[0], element.y + p[1]] as [number, number]);
          if (pts.length >= 2) {
            sketch.linearPath(pts, opts);
            if (element.type === "arrow" && element.endArrowhead && pts.length >= 2) {
              const [ax, ay] = pts[pts.length - 2];
              const [bx, by] = pts[pts.length - 1];
              const angle = Math.atan2(by - ay, bx - ax);
              const head = Math.min(15, Math.max(8, element.strokeWidth * 5));
              ctx.strokeStyle = element.strokeColor;
              ctx.lineWidth = element.strokeWidth;
              ctx.beginPath();
              ctx.moveTo(
                bx - head * Math.cos(angle - Math.PI / 6),
                by - head * Math.sin(angle - Math.PI / 6),
              );
              ctx.lineTo(bx, by);
              ctx.lineTo(
                bx - head * Math.cos(angle + Math.PI / 6),
                by - head * Math.sin(angle + Math.PI / 6),
              );
              ctx.stroke();
            }
          }
          break;
        }
      }
      ctx.restore();
    };

    for (const element of scene.elements) {
      draw(element);
    }
    if (preview) {
      draw(preview);
    }

    const selected = scene.elements.find(
      (element) => element.id === selectedId && !element.isDeleted,
    );
    if (selected) {
      const { x, y, width, height } = elementBounds(selected);
      const padding = 5 / zoom;
      ctx.save();
      if (selected.angle) {
        const cx = x + width / 2;
        const cy = y + height / 2;
        ctx.translate(cx, cy);
        ctx.rotate(selected.angle);
        ctx.translate(-cx, -cy);
      }
      ctx.setLineDash([5 / zoom, 3 / zoom]);
      ctx.strokeStyle = "#6965db";
      ctx.lineWidth = 1.5 / zoom;
      ctx.strokeRect(
        x - padding, y - padding,
        width + padding * 2, height + padding * 2,
      );
      ctx.setLineDash([]);
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  $effect(() => {
    // Re-render only when native document/view state changes.
    scene;
    theme;
    preview;
    selectedId;
    zoom;
    pan;
    viewSize;
    redraw();
  });

  function pointerDown(event: PointerEvent) {
    if (gesture || (event.button !== 0 && event.button !== 1)) {
      return;
    }
    viewport.focus({ preventScroll: true });
    viewport.setPointerCapture(event.pointerId);
    const start = getPoint(event);
    const action = tool === "hand" || event.button === 1
      ? "pan"
      : tool === "selection" ? "move" : tool === "freedraw" ? "free" : "draw";
    let id: string | null = null;
    let draft: ExcalidrawElement | null = null;

    if (action === "move") {
      const hit = pickElement(scene.elements, start, 8 / zoom);
      selectedId = hit?.id ?? null;
      id = hit?.id ?? null;
    } else if (action === "draw" || action === "free") {
      selectedId = null;
      draft = action === "free"
        ? createFreeDraw([start], [event.pressure || 0.5])
        : createShape(tool as NativeShape, start, start);
      preview = draft;
    }
    gesture = {
      pointerId: event.pointerId,
      action,
      start,
      original: scene,
      initialPan: { ...pan },
      id,
      draft,
      changed: false,
      points: [start],
      pressures: [event.pressure || 0.5],
    };
  }

  function pointerMove(event: PointerEvent) {
    const g = gesture;
    if (!g || g.pointerId !== event.pointerId) {
      return;
    }
    if (g.action === "pan") {
      const current = getScreenPoint(event);
      const startScreen = {
        x: g.start.x * zoom + g.initialPan.x,
        y: g.start.y * zoom + g.initialPan.y,
      };
      pan = {
        x: g.initialPan.x + current.x - startScreen.x,
        y: g.initialPan.y + current.y - startScreen.y,
      };
      return;
    }
    const point = getPoint(event);
    const dx = point.x - g.start.x;
    const dy = point.y - g.start.y;
    if (g.action === "move" && g.id) {
      if (Math.hypot(dx, dy) > 0.2) {
        g.changed = true;
        onChange(moveById(g.original, g.id, dx, dy));
      }
    } else if (g.action === "free" && g.draft) {
      const last = g.points[g.points.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) < 0.5 / zoom) {
        return;
      }
      g.points.push(point);
      g.pressures.push(event.pressure || 0.5);
      const shape = createFreeDraw(g.points, g.pressures);
      preview = {
        ...shape,
        id: g.draft.id,
        seed: g.draft.seed,
        versionNonce: g.draft.versionNonce,
      };
    } else if (g.action === "draw" && g.draft) {
      const shape = createShape(tool as NativeShape, g.start, point);
      preview = {
        ...shape,
        id: g.draft.id,
        seed: g.draft.seed,
        versionNonce: g.draft.versionNonce,
      };
    }
  }

  function pointerUp(event: PointerEvent) {
    const g = gesture;
    if (!g || g.pointerId !== event.pointerId) {
      return;
    }
    if (viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
    if (g.action === "move" && g.changed) {
      // The move was previewed in-place; record the *original* scene once.
      history.commit(g.original);
      refreshHistory();
    } else if (g.action === "free" && preview) {
      if (g.points.length > 1) {
        commit(g.original, {
          ...g.original,
          elements: [...g.original.elements, preview],
        });
        selectedId = preview.id;
        tool = "selection";
      }
    } else if (g.action === "draw" && preview) {
      if (Math.max(preview.width, preview.height) >= 3 / zoom) {
        commit(g.original, {
          ...g.original,
          elements: [...g.original.elements, preview],
        });
        selectedId = preview.id;
        tool = "selection";
      }
    }
    preview = null;
    gesture = null;
  }

  function pointerCancel(event: PointerEvent) {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) {
      return;
    }
    if (g.action === "move" && g.changed) {
      onChange(g.original);
    }
    pan = g.initialPan;
    preview = null;
    gesture = null;
  }

  function handleKeys(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (target.closest("input,textarea,[contenteditable=true]")) {
      return;
    }
    const cmd = event.ctrlKey || event.metaKey;
    if (cmd && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if (cmd && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
      event.preventDefault();
      commit(scene, deleteById(scene, selectedId));
      selectedId = null;
      return;
    }
    if (event.key === "Escape") {
      selectedId = null;
      preview = null;
      tool = "selection";
    }
    if (event.key.toLowerCase() === "v") tool = "selection";
    if (event.key.toLowerCase() === "r") tool = "rectangle";
  }

  onMount(() => {
    const observer = new ResizeObserver(() => {
      viewSize = {
        x: viewport.clientWidth,
        y: viewport.clientHeight,
      };
    });
    observer.observe(viewport);
    viewSize = { x: viewport.clientWidth, y: viewport.clientHeight };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const bounds = viewport.getBoundingClientRect();
        const px = event.clientX - bounds.left;
        const py = event.clientY - bounds.top;
        const sx = (px - pan.x) / zoom;
        const sy = (py - pan.y) / zoom;
        const nextZoom = Math.max(0.2, Math.min(5, zoom * Math.exp(-event.deltaY * 0.003)));
        zoom = nextZoom;
        pan = { x: px - sx * zoom, y: py - sy * zoom };
      } else {
        pan = { x: pan.x - event.deltaX, y: pan.y - event.deltaY };
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("wheel", onWheel);
    };
  });
</script>

<div class="native-shell">
  <div class="native-toolbar" aria-label="Инструменты Svelte">
    {#each [
      ["selection", "Выделение"],
      ["rectangle", "Прямоугольник"],
      ["ellipse", "Эллипс"],
      ["diamond", "Ромб"],
      ["line", "Линия"],
      ["arrow", "Стрелка"],
      ["freedraw", "Карандаш"],
      ["hand", "Рука"],
    ] as item}
      <button
        class:active={tool === item[0]}
        onclick={() => { tool = item[0] as NativeTool; selectedId = null; }}
        title={item[1]}
        aria-pressed={tool === item[0]}
      >
        {item[1]}
      </button>
    {/each}
    <span class="separator"></span>
    <button disabled={!undoAvailable} onclick={undo} title="Отменить (Ctrl+Z)">↶</button>
    <button disabled={!redoAvailable} onclick={redo} title="Повторить (Ctrl+Shift+Z)">↷</button>
    <span class="zoom">{Math.round(zoom * 100)}%</span>
    <button onclick={() => { zoom = 1; pan = { x: 0, y: 0 }; }} title="Сбросить масштаб">100%</button>
  </div>

  {#if unsupported > 0}
    <div class="warning" role="status">
      В нативном режиме не отображается элементов: {unsupported}.
      Они сохраняются в файле. Для просмотра переключитесь на полный редактор.
    </div>
  {/if}

  <div
    class="native-viewport"
    class:hand={tool === "hand"}
    role="application"
    tabindex="0"
    aria-label="Нативный холст Excalidraw"
    bind:this={viewport}
    onpointerdown={pointerDown}
    onpointermove={pointerMove}
    onpointerup={pointerUp}
    onpointercancel={pointerCancel}
    onkeydown={handleKeys}
  >
    <canvas bind:this={canvas}></canvas>
  </div>
</div>

<style>
  .native-shell { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .native-toolbar {
    z-index: 1; display: flex; gap: 6px; flex-wrap: wrap; align-items: center;
    padding: 8px 12px; border-bottom: 1px solid #dedee4; background: #fff;
  }
  .native-toolbar button {
    padding: 5px 9px; border: 1px solid #dadae2; background: white;
    border-radius: 7px; font-size: 12px; cursor: pointer;
  }
  .native-toolbar button.active { background: #e8e7fa; border-color: #7771d0; }
  .native-toolbar button:disabled { opacity: 0.45; cursor: default; }
  .separator { height: 22px; width: 1px; background: #dadae2; margin: 0 3px; }
  .zoom { font-size: 12px; white-space: nowrap; }
  .warning {
    padding: 6px 12px; font-size: 12px; background: #fff0c2; color: #674900;
  }
  .native-viewport {
    flex: 1; min-height: 0; min-width: 0; position: relative; overflow: hidden;
    outline-offset: -2px; cursor: crosshair; touch-action: none;
  }
  .native-viewport.hand { cursor: grab; }
  .native-viewport canvas { display: block; width: 100%; height: 100%; }
</style>
