<script lang="ts">
  import { onMount, tick } from "svelte";
  import rough from "roughjs/bin/rough";

  import { applyDarkModeFilter } from "@excalidraw/common";

  import type { ExcalidrawElement } from "@excalidraw/element/types";
  import { SceneHistory } from "./native/history";
  import { paintNativeText } from "./native/text";
  import {
    addNativeImage,
    NativeImageCache,
    paintNativeImage,
    nativeImageSource,
    NATIVE_IMAGE_TYPES,
  } from "./native/images";
  import {
    appendNativeArrow,
    isNativeLinkedArrow,
    nativeLinkedEndpoints,
    pickNativeLinkedEndpoint,
    reconnectNativeEndpoint,
  } from "./native/bindings";
  import {
    createShape,
    createFreeDraw,
    createText,
    replaceText,
    deleteById,
    elementBounds,
    isNativeShape,
    pickElement,
    unsupportedCount,
    type NativeShape,
    type NativeTool,
    type Point,
    type SceneFile,
  } from "./native/scene";
  import {
    deleteSelection,
    flipNativeImage,
    handleLocations,
    isBoxTransformable,
    moveSelection,
    pickHandle,
    transformSelected,
    type Handle,
  } from "./native/transforms";
  import {
    endpointLocations,
    pickEndpoint,
    updateLineEndpoint,
    type Endpoint,
  } from "./native/lines";
  import {
    duplicateSelection,
    elementsInMarquee,
    rectangleBetween,
  } from "./native/selection";
  import {
    editableSelection,
    groupSelection,
    selectionUnit,
    ungroupSelection,
  } from "./native/groups";

  type Props = {
    scene: SceneFile;
    theme: "light" | "dark";
    documentEpoch: number;
    onChange: (scene: SceneFile) => void;
  };

  let { scene, theme, documentEpoch, onChange }: Props = $props();

  let canvas: HTMLCanvasElement;
  let viewport: HTMLDivElement;
  let textInput = $state<HTMLTextAreaElement>();
  let imageInput: HTMLInputElement;

  let tool = $state<NativeTool>("selection");
  let selectedIds = $state<string[]>([]);
  let selectedId = $derived(selectedIds.length === 1 ? selectedIds[0] : null);
  let selectedRaster = $derived(
    scene.elements.find(
      (element) =>
        element.id === selectedId &&
        element.type === "image" &&
        isBoxTransformable(element, scene),
    ),
  );
  let preview = $state.raw<ExcalidrawElement | null>(null);
  let marquee = $state<{ start: Point; end: Point } | null>(null);
  let zoom = $state(1);
  let pan = $state<Point>({ x: 0, y: 0 });
  let viewSize = $state<Point>({ x: 0, y: 0 });
  let undoAvailable = $state(false);
  let redoAvailable = $state(false);
  let imageError = $state("");
  let unsupported = $derived(unsupportedCount(scene));
  let textEditor = $state<{ id: string | null; at: Point; value: string } | null>(null);

  const history = new SceneHistory();
  const imageCache = new NativeImageCache();

  // Imported and newly inserted files are decoded lazily and cached by fileId.
  $effect(() => {
    imageCache.sync(scene, redraw);
  });

  async function importImage(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) {
      return;
    }
    imageError = "";
    if (!NATIVE_IMAGE_TYPES.some((type) => type === file.type) ||
        file.size > 12 * 1024 * 1024) {
      imageError = "Допустимы PNG, JPEG, GIF и WebP размером до 12 МБ.";
      return;
    }
    try {
      const dataURL = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Не удалось прочитать изображение."));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
      const decoded = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Не удалось открыть изображение."));
        image.src = dataURL;
      });
      const center = {
        x: (viewSize.x / 2 - pan.x) / zoom,
        y: (viewSize.y / 2 - pan.y) / zoom,
      };
      const result = addNativeImage(
        scene,
        { mimeType: file.type, dataURL },
        { width: decoded.naturalWidth, height: decoded.naturalHeight },
        center,
      );
      commit(scene, result.scene);
      selectedIds = [result.element.id];
      tool = "selection";
    } catch (error) {
      imageError = error instanceof Error ? error.message : "Ошибка загрузки изображения.";
    }
  }

  type Gesture = {
    pointerId: number;
    action: "draw" | "move" | "pan" | "free" | "transform" | "select" | "endpoint";
    start: Point;
    original: SceneFile;
    initialPan: Point;
    id: string | null;
    ids: string[];
    handle: Handle | null;
    endpoint: Endpoint | null;
    initialSelection: string[];
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
    selectedIds = [];
    marquee = null;
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

  function duplicate() {
    if (!selectedIds.length || textEditor || gesture) {
      return;
    }
    const result = duplicateSelection(scene, selectedIds);
    if (result.ids.length) {
      commit(scene, result.scene);
      selectedIds = result.ids;
    }
  }

  function flipSelectedImage(axis: "horizontal" | "vertical") {
    if (!selectedId || !selectedRaster || gesture || textEditor) {
      return;
    }
    const next = flipNativeImage(scene, selectedId, axis);
    if (next !== scene) {
      commit(scene, next);
    }
  }

  function groupSelected() {
    if (gesture || textEditor) {
      return;
    }
    const result = groupSelection(scene, selectedIds);
    if (result.groupId) {
      commit(scene, result.scene);
      selectedIds = result.ids;
    }
  }

  function ungroupSelected() {
    if (gesture || textEditor) {
      return;
    }
    const result = ungroupSelection(scene, selectedIds);
    if (result.ids.length) {
      commit(scene, result.scene);
      selectedIds = result.ids;
    }
  }

  function undo() {
    if (history.canUndo) {
      onChange(history.undo(scene));
      refreshHistory();
      selectedIds = [];
    }
  }

  function redo() {
    if (history.canRedo) {
      onChange(history.redo(scene));
      refreshHistory();
      selectedIds = [];
    }
  }


  async function beginText(at: Point, existing?: ExcalidrawElement) {
    if (existing && existing.type !== "text") {
      return;
    }
    if (textEditor) {
      finishText();
    }
    textEditor = {
      id: existing?.id ?? null,
      at: existing ? { x: existing.x, y: existing.y } : at,
      value: existing?.type === "text" ? existing.text : "",
    };
    await tick();
    textInput?.focus();
    textInput?.select();
  }

  function finishText() {
    const editor = textEditor;
    if (!editor) {
      return;
    }
    textEditor = null;
    const value = editor.value.trimEnd();
    if (!value.trim()) {
      if (editor.id) {
        commit(scene, deleteById(scene, editor.id));
      }
    } else if (editor.id) {
      const existing = scene.elements.find((element) => element.id === editor.id);
      if (existing?.type === "text" && value !== existing.text) {
        commit(scene, replaceText(scene, editor.id, value));
        selectedIds = [editor.id];
      }
    } else {
      const element = createText(editor.at, value);
      commit(scene, { ...scene, elements: [...scene.elements, element] });
      selectedIds = [element.id];
    }
    tool = "selection";
  }

  function textKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      textEditor = null;
      event.stopPropagation();
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      finishText();
    }
    event.stopPropagation();
  }

  function doubleClick(event: MouseEvent) {
    if (tool !== "selection") {
      return;
    }
    const hit = pickElement(scene.elements, getPoint(event), 8 / zoom);
    if (hit?.type === "text" && hit.containerId === null) {
      void beginText({ x: hit.x, y: hit.y }, hit);
    }
  }

  function getPoint(event: Pick<PointerEvent, "clientX" | "clientY">): Point {
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
      if (element.type === "image") {
        const file = nativeImageSource(scene, element);
        const image = file ? imageCache.get(file.id) : null;
        if (paintNativeImage(ctx, element, image)) {
          return;
        }
        // Keep unloaded/missing raster elements visible without mutating data.
        ctx.save();
        ctx.strokeStyle = theme === "dark" ? "#9494a8" : "#9c9cad";
        ctx.lineWidth = 1 / zoom;
        ctx.setLineDash([4 / zoom, 4 / zoom]);
        ctx.strokeRect(element.x, element.y, element.width, element.height);
        ctx.beginPath();
        ctx.moveTo(element.x, element.y);
        ctx.lineTo(element.x + element.width, element.y + element.height);
        ctx.moveTo(element.x + element.width, element.y);
        ctx.lineTo(element.x, element.y + element.height);
        ctx.stroke();
        ctx.restore();
        return;
      }
      const { x, y, width, height } = elementBounds(element);
      const stroke = theme === "dark"
        ? applyDarkModeFilter(element.strokeColor)
        : element.strokeColor;
      const fill = element.backgroundColor === "transparent"
        ? undefined
        : theme === "dark"
          ? applyDarkModeFilter(element.backgroundColor)
          : element.backgroundColor;
      const opts = {
        seed: element.seed,
        roughness: element.roughness,
        stroke,
        strokeWidth: element.strokeWidth,
        fill,
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
          paintNativeText(ctx, element, stroke);
          break;
        }
        case "freedraw": {
          const points = element.points.map((p) => [element.x + p[0], element.y + p[1]] as const);
          if (points.length) {
            ctx.beginPath();
            ctx.strokeStyle = stroke;
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
              ctx.strokeStyle = stroke;
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

    for (const element of scene.elements) {
      if (!selectedIds.includes(element.id) || element.isDeleted || !isNativeShape(element)) {
        continue;
      }
      const { x, y, width, height } = elementBounds(element);
      const padding = 5 / zoom;
      ctx.save();
      if (element.angle) {
        const cx = x + width / 2;
        const cy = y + height / 2;
        ctx.translate(cx, cy);
        ctx.rotate(element.angle);
        ctx.translate(-cx, -cy);
      }
      ctx.setLineDash([5 / zoom, 3 / zoom]);
      ctx.strokeStyle = "#6965db";
      ctx.lineWidth = 1.5 / zoom;
      ctx.strokeRect(
        x - padding, y - padding,
        width + padding * 2, height + padding * 2,
      );
      ctx.restore();

      if (selectedId === element.id && isBoxTransformable(element, scene)) {
        const handles = handleLocations(element);
        const top = {
          x: (handles.nw.x + handles.ne.x) / 2,
          y: (handles.nw.y + handles.ne.y) / 2,
        };
        ctx.strokeStyle = "#6965db";
        ctx.lineWidth = 1.5 / zoom;
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(handles.rotate.x, handles.rotate.y);
        ctx.stroke();
        ctx.fillStyle = theme === "dark" ? "#282637" : "#ffffff";
        for (const key of ["nw", "ne", "sw", "se"] as const) {
          const p = handles[key];
          ctx.fillRect(p.x - 5 / zoom, p.y - 5 / zoom, 10 / zoom, 10 / zoom);
          ctx.strokeRect(p.x - 5 / zoom, p.y - 5 / zoom, 10 / zoom, 10 / zoom);
        }
        ctx.beginPath();
        ctx.arc(handles.rotate.x, handles.rotate.y, 6 / zoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      if (selectedId === element.id) {
        const locations = nativeLinkedEndpoints(scene, element) ?? endpointLocations(element);
        if (locations) {
          ctx.save();
          ctx.fillStyle = theme === "dark" ? "#282637" : "#fff";
          ctx.strokeStyle = "#6965db";
          ctx.lineWidth = 1.5 / zoom;
          for (const p of [locations.start, locations.end]) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 5 / zoom, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
          ctx.restore();
        }
      }
    }
    if (marquee) {
      const { x, y, width, height } = rectangleBetween(marquee.start, marquee.end);
      ctx.save();
      ctx.fillStyle = "rgba(105, 101, 219, 0.09)";
      ctx.strokeStyle = "#6965db";
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  $effect(() => {
    // Re-render only when native document/view state changes.
    scene;
    theme;
    preview;
    selectedIds;
    marquee;
    zoom;
    pan;
    viewSize;
    redraw();
  });

  function pointerDown(event: PointerEvent) {
    if (gesture || textEditor || (event.button !== 0 && event.button !== 1)) {
      return;
    }
    viewport.focus({ preventScroll: true });
    const start = getPoint(event);
    if (tool === "text" && event.button === 0) {
      void beginText(start);
      return;
    }
    viewport.setPointerCapture(event.pointerId);
    let action: Gesture["action"] =
      tool === "hand" || event.button === 1
        ? "pan"
        : tool === "selection"
          ? "move"
          : tool === "freedraw"
            ? "free"
            : "draw";
    let id: string | null = null;
    let ids: string[] = [];
    let handle: Handle | null = null;
    let endpoint: Endpoint | null = null;
    const initialSelection = [...selectedIds];
    let draft: ExcalidrawElement | null = null;

    if (action === "move") {
      const selected = scene.elements.find((element) => element.id === selectedId);
      endpoint = !event.shiftKey && selected
        ? (pickNativeLinkedEndpoint(scene, selected, start, 9 / zoom) ??
            pickEndpoint(selected, start, 9 / zoom)) : null;
      handle = !event.shiftKey && selected
        ? pickHandle(selected, start, 9 / zoom, scene) : null;
      if (endpoint && selectedId) {
        action = "endpoint";
        id = selectedId;
        ids = [selectedId];
      } else if (handle && selectedId) {
        action = "transform";
        id = selectedId;
        ids = [selectedId];
      } else {
        const target = pickElement(scene.elements, start, 8 / zoom);
        const unit = target ? selectionUnit(scene, target.id) : [];
        if (event.shiftKey) {
          if (unit.length) {
            const fullySelected = unit.every((item) => selectedIds.includes(item));
            selectedIds = fullySelected
              ? selectedIds.filter((item) => !unit.includes(item))
              : [...new Set([...selectedIds, ...unit])];
          }
          action = "select";
        } else if (unit.length) {
          ids = unit.every((item) => selectedIds.includes(item))
            ? [...selectedIds] : unit;
          selectedIds = ids;
          id = target!.id;
        } else {
          selectedIds = [];
          action = "select";
        }
      }
    } else if (action === "draw" || action === "free") {
      selectedIds = [];
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
      ids,
      handle,
      endpoint,
      initialSelection,
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
      if (Math.hypot(dx, dy) > 0.2 && editableSelection(g.original, g.ids).length) {
        g.changed = true;
        onChange(moveSelection(g.original, g.ids, dx, dy));
      }
    } else if (g.action === "transform" && g.id && g.handle) {
      if (Math.hypot(dx, dy) > 0.2) {
        g.changed = true;
        onChange(transformSelected(g.original, g.id, g.handle, point));
      }
    } else if (g.action === "endpoint" && g.id && g.endpoint) {
      if (Math.hypot(dx, dy) > 0.2) {
        g.changed = true;
        const element = g.original.elements.find((item) => item.id === g.id);
        onChange(element && isNativeLinkedArrow(g.original, element)
          ? reconnectNativeEndpoint(g.original, g.id, g.endpoint, point)
          : updateLineEndpoint(g.original, g.id, g.endpoint, point));
      }
    } else if (g.action === "select") {
      if (Math.hypot(dx, dy) > 4 / zoom) {
        g.changed = true;
        marquee = { start: g.start, end: point };
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
    if (
      (g.action === "move" || g.action === "transform" || g.action === "endpoint") &&
      g.changed
    ) {
      // The move was previewed in-place; record the *original* scene once.
      history.commit(g.original);
      refreshHistory();
    } else if (g.action === "select" && g.changed && marquee) {
      const hits = elementsInMarquee(g.original, marquee.start, marquee.end);
      selectedIds = event.shiftKey
        ? [...new Set([...g.initialSelection, ...hits])]
        : hits;
    } else if (g.action === "free" && preview) {
      if (g.points.length > 1) {
        commit(g.original, {
          ...g.original,
          elements: [...g.original.elements, preview],
        });
        selectedIds = [preview.id];
        tool = "selection";
      }
    } else if (g.action === "draw" && preview) {
      if (Math.max(preview.width, preview.height) >= 3 / zoom) {
        const next = preview.type === "arrow"
          ? appendNativeArrow(g.original, preview, g.start, getPoint(event))
          : { ...g.original, elements: [...g.original.elements, preview] };
        commit(g.original, next);
        selectedIds = [preview.id];
        tool = "selection";
      }
    }
    preview = null;
    marquee = null;
    gesture = null;
  }

  function pointerCancel(event: PointerEvent) {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) {
      return;
    }
    if (
      (g.action === "move" || g.action === "transform" || g.action === "endpoint") &&
      g.changed
    ) {
      onChange(g.original);
    }
    pan = g.initialPan;
    if (g.action === "select") {
      selectedIds = g.initialSelection;
    }
    marquee = null;
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
    if (cmd && event.key.toLowerCase() === "g") {
      event.preventDefault();
      if (event.shiftKey) {
        ungroupSelected();
      } else {
        groupSelected();
      }
      return;
    }
    if (cmd && event.key.toLowerCase() === "d") {
      event.preventDefault();
      duplicate();
      return;
    }
    if (cmd && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selectedIds = editableSelection(
        scene,
        scene.elements.map((element) => element.id),
      );
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length) {
      event.preventDefault();
      const next = deleteSelection(scene, selectedIds);
      if (next.elements.some((el, i) => el.isDeleted !== scene.elements[i].isDeleted)) {
        commit(scene, next);
      }
      selectedIds = [];
      return;
    }
    if (event.key === "Escape") {
      selectedIds = [];
      preview = null;
      tool = "selection";
      return;
    }
    const nudges: Record<string, Point> = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
    };
    if (!cmd && selectedIds.length && nudges[event.key]) {
      event.preventDefault();
      const multiplier = event.shiftKey ? 10 : 1;
      const offset = nudges[event.key];
      const next = moveSelection(
        scene,
        selectedIds,
        offset.x * multiplier,
        offset.y * multiplier,
      );
      if (next !== scene && next.elements.some((el, i) => el !== scene.elements[i])) {
        commit(scene, next);
      }
      return;
    }
    if (cmd || event.altKey) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "v") tool = "selection";
    if (key === "r") tool = "rectangle";
    if (key === "e") tool = "ellipse";
    if (key === "d") tool = "diamond";
    if (key === "l") tool = "line";
    if (key === "a") tool = "arrow";
    if (key === "t") tool = "text";
    if (key === "p") tool = "freedraw";
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
      ["text", "Текст"],
      ["hand", "Рука"],
    ] as item}
      <button
        class:active={tool === item[0]}
        onclick={() => { tool = item[0] as NativeTool; selectedIds = []; }}
        title={item[1]}
        aria-pressed={tool === item[0]}
      >
        {item[1]}
      </button>
    {/each}
    <span class="separator"></span>
    <input
      class="file-input"
      type="file"
      accept={NATIVE_IMAGE_TYPES.join(",")}
      bind:this={imageInput}
      onchange={importImage}
      aria-label="Выбрать изображение"
    />
    <button onclick={() => imageInput.click()}>Изображение</button>
    {#if selectedRaster}
      <button onclick={() => flipSelectedImage("horizontal")} title="Отразить выбранное изображение по горизонтали">↔ Отразить</button>
      <button onclick={() => flipSelectedImage("vertical")} title="Отразить выбранное изображение по вертикали">↕ Отразить</button>
    {/if}
    <button disabled={!undoAvailable} onclick={undo} title="Отменить (Ctrl+Z)">↶</button>
    <button disabled={!redoAvailable} onclick={redo} title="Повторить (Ctrl+Shift+Z)">↷</button>
    <button disabled={!selectedIds.length} onclick={duplicate} title="Дублировать (Ctrl+D)">Дублировать</button>
    <button disabled={selectedIds.length < 2} onclick={groupSelected} title="Группировать (Ctrl+G)">Группа</button>
    <button disabled={!selectedIds.length} onclick={ungroupSelected} title="Разгруппировать (Ctrl+Shift+G)">Разгруппа</button>
    <span class="zoom">{Math.round(zoom * 100)}%</span>
    {#if selectedIds.length > 1}<span class="zoom">Выделено: {selectedIds.length}</span>{/if}
    <button onclick={() => { zoom = 1; pan = { x: 0, y: 0 }; }} title="Сбросить масштаб">100%</button>
  </div>

  {#if imageError}
    <div class="warning" role="alert">{imageError}</div>
  {/if}
  {#if unsupported > 0}
    <div class="warning" role="status">
      В нативном режиме не отображается элементов: {unsupported}.
      Они сохраняются в файле. Для просмотра переключитесь на полный редактор.
    </div>
  {/if}

  <div
    class="native-viewport"
    class:hand={tool === "hand"}
    class:text-tool={tool === "text"}
    role="application"
    tabindex="0"
    aria-label="Нативный холст Excalidraw"
    bind:this={viewport}
    onpointerdown={pointerDown}
    onpointermove={pointerMove}
    onpointerup={pointerUp}
    onpointercancel={pointerCancel}
    ondblclick={doubleClick}
    onkeydown={handleKeys}
  >
    <canvas bind:this={canvas}></canvas>
    {#if textEditor}
      <textarea
        class="text-input"
        bind:this={textInput}
        bind:value={textEditor.value}
        aria-label="Редактировать текст"
        placeholder="Введите текст…"
        style:left={(textEditor.at.x * zoom + pan.x) + "px"}
        style:top={(textEditor.at.y * zoom + pan.y) + "px"}
        style:font-size={(20 * zoom) + "px"}
        onpointerdown={(event) => event.stopPropagation()}
        onkeydown={textKeyDown}
        onblur={finishText}
      ></textarea>
    {/if}
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
  .file-input { display: none; }
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
  .native-viewport.text-tool { cursor: text; }
  .native-viewport canvas { display: block; width: 100%; height: 100%; }
  .text-input {
    position: absolute; z-index: 2; min-width: 180px; min-height: 68px;
    padding: 4px; border: 1px solid #6965db; border-radius: 3px;
    background: #fff; color: #20232b; font-family: sans-serif;
    line-height: 1.25; resize: both;
  }
</style>
