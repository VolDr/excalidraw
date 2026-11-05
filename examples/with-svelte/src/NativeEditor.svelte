<script lang="ts">
  import { onMount, tick } from "svelte";
  import rough from "roughjs/bin/rough";

  import { applyDarkModeFilter, DEFAULT_FONT_FAMILY, FONT_FAMILY, getFontFamilyString } from "@excalidraw/common";

  import type { ExcalidrawElement, ExcalidrawTextElement, FontFamilyValues } from "@excalidraw/element/types";
  import { nativeElementsMap } from "./native/coreAdapter";
  import { isCoreDrawableElement, paintCoreDrawableElement, paintCoreImageElement, paintCoreTextElement } from "./native/renderCore";
  import { SceneHistory } from "./native/history";
  import { indexInsertedNativeElements } from "./native/ordering";
  import { canMoveNativeLayer, moveNativeLayerWithCore, type NativeLayerMove } from "./native/zOrder";
  import { fitNativeViewportWithCore, type NativeViewportFit } from "./native/viewport";
  import { canLayoutNativeSelection, nativeLayoutUnitCount, layoutNativeSelectionWithCore, type NativeLayoutAction } from "./native/layout";
  import { applyNativeStyle, nativeStyleTarget, type NativeStyleChange } from "./native/styles";
  import { applyNativeTypography, nativeTypographyTarget, type NativeTypographyChange } from "./native/textStyles";
  import { cropNativeImageCenter, resetNativeImageCrop } from "./native/imageCrop";
  import {
    nativeBoundLabelLayout,
    nativeEditableLabel,
    updateNativeBoxLabel,
  } from "./native/boundText";
  import {
    addNativeImage,
    NativeImageCache,
    nativeImageSource,
    NATIVE_IMAGE_TYPES,
  } from "./native/images";
  import {
    appendNativeArrow,
    isNativeLinkedArrow,
    isNativeOrbitLinkedArrow,
    nativeLinkedEndpoints,
    nativeOrbitEndpoints,
    pickNativeLinkedEndpoint,
    pickNativeOrbitEndpoint,
    reconnectNativeEndpoint,
    reconnectNativeOrbitEndpoint,
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
    coreHandleLocations,
    isBoxTransformable,
    moveSelection,
    pickHandle,
    transformSelected,
    type Handle,
  } from "./native/transforms";
  import {
    canEditElbowEndpoints,
    canEditLinearPoints,
    convertArrowToElbow,
    deleteLinearMidpoint,
    elbowEndpointLocations,
    insertLinearMidpoint,
    linearPointLocations,
    linearSegmentMidpoints,
    pickLinearPoint,
    pickLinearSegmentMidpoint,
    pickElbowEndpoint,
    updateLinearPoint,
    type Endpoint,
  } from "./native/lines";
  import {
    duplicateSelection,
    elementsInMarquee,
    rectangleBetween,
  } from "./native/selection";
  import { copyNativeSelection, cutNativeSelection, pasteNativeSelection } from "./native/clipboard";
  import {
    editableSelection,
    groupSelection,
    selectionUnit,
    ungroupSelection,
  } from "./native/groups";

  import {
    groupHandleLocations,
    pickGroupHandle,
    transformableGroup,
    transformGroup,
  } from "./native/groupTransforms";

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
  let layoutAvailable = $derived(canLayoutNativeSelection(scene, selectedIds));
  let layoutUnits = $derived(nativeLayoutUnitCount(scene, selectedIds));
  let layerAvailable = $derived(canMoveNativeLayer(scene, selectedIds));
  let styleTarget = $derived(nativeStyleTarget(scene, selectedId));
  let typographyTarget = $derived(nativeTypographyTarget(scene, selectedId));
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
  let textEditor = $state<{
    id: string | null;
    boxId: string | null;
    at: Point;
    value: string;
    width: number | null;
    fontSize: number;
    fontFamily: FontFamilyValues;
    lineHeight: number;
    textAlign: ExcalidrawTextElement["textAlign"];
  } | null>(null);

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
    action: "draw" | "move" | "pan" | "free" | "transform" | "group-transform" | "select" | "endpoint";
    start: Point;
    original: SceneFile;
    latest: SceneFile;
    initialPan: Point;
    id: string | null;
    ids: string[];
    handle: Handle | null;
    endpoint: Endpoint | null;
    pointIndex: number | null;
    initialSelection: string[];
    draft: ExcalidrawElement | null;
    changed: boolean;
    points: Point[];
    pressures: number[];
  };
  let gesture: Gesture | null = null;
  let lastPastedText: string | null = null;
  let pasteNumber = 0;

  // Replace the undo stack after an explicit file import or editor reset.
  $effect(() => {
    documentEpoch;
    history.clear();
    lastPastedText = null;
    pasteNumber = 0;
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
    if (previous === next) {
      return;
    }
    const indexed = indexInsertedNativeElements(previous, next);
    history.commit(previous, indexed);
    onChange(indexed);
    refreshHistory();
  }

  function copySelected(event: ClipboardEvent) {
    if (gesture || textEditor || !event.clipboardData) {
      return;
    }
    const payload = copyNativeSelection(scene, selectedIds);
    if (payload) {
      event.clipboardData.setData("text/plain", payload);
      event.preventDefault();
      lastPastedText = null;
      pasteNumber = 0;
    }
  }

  function cutSelected(event: ClipboardEvent) {
    if (gesture || textEditor || !event.clipboardData) {
      return;
    }
    const result = cutNativeSelection(scene, selectedIds);
    if (result.text) {
      event.clipboardData.setData("text/plain", result.text);
      event.preventDefault();
      lastPastedText = null;
      pasteNumber = 0;
      commit(scene, result.scene);
      selectedIds = [];
    }
  }

  function pasteSelected(event: ClipboardEvent) {
    if (gesture || textEditor || !event.clipboardData) {
      return;
    }
    const encoded = event.clipboardData.getData("text/plain");
    const nextPasteNumber = encoded === lastPastedText ? pasteNumber + 1 : 1;
    const result = pasteNativeSelection(scene, encoded, nextPasteNumber * 24);
    if (result.ids.length) {
      lastPastedText = encoded;
      pasteNumber = nextPasteNumber;
      event.preventDefault();
      commit(scene, result.scene);
      selectedIds = result.ids;
      tool = "selection";
    }
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

  function layoutSelection(action: NativeLayoutAction) {
    if (!layoutAvailable || gesture || textEditor) {
      return;
    }
    const next = layoutNativeSelectionWithCore(scene, selectedIds, action);
    if (next !== scene) {
      commit(scene, next);
    }
  }

  function moveLayer(direction: NativeLayerMove) {
    if (!layerAvailable || gesture || textEditor) {
      return;
    }
    const next = moveNativeLayerWithCore(scene, selectedIds, direction);
    if (next !== scene) {
      commit(scene, next);
    }
  }

  function fitView(mode: NativeViewportFit) {
    if (gesture || textEditor) {
      return;
    }
    const fitted = fitNativeViewportWithCore(
      scene, selectedIds, mode, viewSize, zoom, pan,
    );
    if (fitted) {
      zoom = fitted.zoom;
      pan = fitted.pan;
    }
  }

  function changeTypography(change: NativeTypographyChange) {
    if (!typographyTarget || gesture || textEditor) {
      return;
    }
    const next = applyNativeTypography(scene, selectedId ?? typographyTarget.id, change);
    if (next !== scene) {
      commit(scene, next);
    }
  }

  function changeStyle(change: NativeStyleChange) {
    if (!styleTarget || gesture || textEditor) {
      return;
    }
    const next = applyNativeStyle(scene, styleTarget.id, change);
    if (next !== scene) {
      commit(scene, next);
    }
  }

  function colorForInput(value: string): string {
    return /^#[0-9a-f]{6}$/i.test(value) ? value : "#1e1e1e";
  }

  function fillForInput(value: string): string {
    return /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff";
  }

  function cropSelectedImage() {
    if (
      !selectedRaster ||
      selectedRaster.type !== "image" ||
      !selectedId ||
      gesture ||
      textEditor
    ) {
      return;
    }
    const raster = imageCache.get(selectedRaster.fileId);
    if (!raster) {
      return;
    }
    const next = cropNativeImageCenter(scene, selectedId, {
      width: raster.naturalWidth,
      height: raster.naturalHeight,
    });
    if (next !== scene) {
      commit(scene, next);
    }
  }

  function resetSelectedCrop() {
    if (!selectedRaster || !selectedId || gesture || textEditor) {
      return;
    }
    const next = resetNativeImageCrop(scene, selectedId);
    if (next !== scene) {
      commit(scene, next);
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


  async function beginText(
    at: Point,
    existing?: ExcalidrawElement,
    boxId: string | null = null,
  ) {
    if (
      existing &&
      (existing.type !== "text" ||
        (existing.containerId !== null &&
          existing.containerId !== boxId) ||
        existing.locked ||
        existing.isDeleted ||
        existing.angle !== 0)
    ) {
      return;
    }
    if (textEditor) {
      finishText();
    }
    textEditor = {
      id: existing?.id ?? null,
      boxId,
      at: boxId ? at : existing ? { x: existing.x, y: existing.y } : at,
      value:
        existing?.type === "text"
          ? (existing.originalText ?? existing.text)
          : "",
      width: boxId
        ? Math.max(
            40,
            (scene.elements.find((item) => item.id === boxId)?.width ?? 220) -
              24,
          )
        : existing?.type === "text" && !existing.autoResize
          ? existing.width
          : null,
      fontSize: existing?.type === "text" ? existing.fontSize : 20,
      fontFamily: existing?.type === "text" ? existing.fontFamily : DEFAULT_FONT_FAMILY,
      lineHeight: existing?.type === "text" ? existing.lineHeight : 1.25,
      textAlign: existing?.type === "text" ? existing.textAlign : "left",
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
    if (editor.boxId) {
      const next = updateNativeBoxLabel(scene, editor.boxId, value);
      if (next !== scene) {
        commit(scene, next);
      }
      // Keep the whole native group selected after editing an internal label.
      selectedIds = selectionUnit(next, editor.boxId);
    } else if (!value.trim()) {
      if (editor.id) {
        commit(scene, deleteById(scene, editor.id));
      }
    } else if (editor.id) {
      const existing = scene.elements.find((element) => element.id === editor.id);
      if (
        existing?.type === "text" &&
        !existing.locked &&
        existing.containerId === null &&
        value !== (existing.originalText ?? existing.text)
      ) {
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
    if (!hit) {
      return;
    }
    if (
      hit.type === "text" &&
      hit.containerId === null &&
      !hit.locked &&
      hit.angle === 0
    ) {
      void beginText({ x: hit.x, y: hit.y }, hit);
      return;
    }
    if (
      (hit.type === "rectangle" ||
        hit.type === "ellipse" ||
        hit.type === "diamond") &&
      hit.angle === 0
    ) {
      const label = nativeEditableLabel(scene, hit);
      if (label !== undefined) {
        const position = label ? nativeBoundLabelLayout(scene, label) : null;
        const at = position
          ? { x: position.x, y: position.y }
          : { x: hit.x + 12, y: hit.y + 12 };
        void beginText(at, label ?? undefined, hit.id);
      }
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
    const canvasBackgroundColor = theme === "dark"
      ? "#1e1e1e"
      : (typeof scene.appState.viewBackgroundColor === "string"
        ? scene.appState.viewBackgroundColor : "#ffffff");
    ctx.fillStyle = canvasBackgroundColor;
    ctx.fillRect(0, 0, w, h);

    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * pan.x, dpr * pan.y);
    const sketch = rough.canvas(canvas);
    const elementsMap = nativeElementsMap(scene);

    const draw = (element: ExcalidrawElement) => {
      const label = nativeBoundLabelLayout(scene, element);
      if (label) {
        paintCoreTextElement(ctx, label, theme);
        return;
      }
      if (!isNativeShape(element)) {
        return;
      }
      if (element.type === "image") {
        const file = nativeImageSource(scene, element);
        const image = file ? imageCache.get(file.id) : null;
        if (file && image && paintCoreImageElement(ctx, element, image, file.mimeType, theme, dpr)) {
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
      if (isCoreDrawableElement(element)) {
        paintCoreDrawableElement(
          ctx,
          sketch,
          element,
          elementsMap,
          theme,
          canvasBackgroundColor,
        );
        return;
      }

      if (element.type === "text") {
        paintCoreTextElement(ctx, element, theme);
      }
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
        const handles = coreHandleLocations(element, zoom, scene) ?? handleLocations(element);
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
        const linked = nativeLinkedEndpoints(scene, element);
        const orbit = nativeOrbitEndpoints(scene, element);
        const elbow = elbowEndpointLocations(element);
        const points = linked ?? orbit
          ? [(linked ?? orbit)!.start, (linked ?? orbit)!.end]
          : elbow
            ? [elbow.start, elbow.end]
            : linearPointLocations(element);
        if (points) {
          ctx.save();
          ctx.fillStyle = theme === "dark" ? "#282637" : "#fff";
          ctx.strokeStyle = "#6965db";
          ctx.lineWidth = 1.5 / zoom;
          for (const [pointIndex, p] of points.entries()) {
            const radius = pointIndex === 0 || pointIndex === points.length - 1
              ? 5 : 4;
            ctx.beginPath();
            ctx.arc(p.x, p.y, radius / zoom, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
          ctx.restore();
        }
        if (!linked && !orbit && !elbow) {
          const midpoints = linearSegmentMidpoints(element);
          if (midpoints) {
            ctx.save();
            ctx.fillStyle = theme === "dark" ? "#b9b6fc" : "#6965db";
            ctx.strokeStyle = theme === "dark" ? "#282637" : "#fff";
            ctx.lineWidth = 1 / zoom;
            for (const p of midpoints) {
              ctx.beginPath();
              ctx.arc(p.x, p.y, 3.5 / zoom, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
            ctx.restore();
          }
        }
      }
    }
    const selectedGroup = transformableGroup(scene, selectedIds);
    if (selectedGroup) {
      const { x, y, width, height } = selectedGroup.bounds;
      const handles = groupHandleLocations(selectedGroup.bounds);
      const pad = 5 / zoom;
      ctx.save();
      ctx.strokeStyle = "#6965db";
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([5 / zoom, 3 / zoom]);
      ctx.strokeRect(x - pad, y - pad, width + pad * 2, height + pad * 2);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x + width / 2, y);
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
      ctx.restore();
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
    // Alt-click on a selected internal point removes it; Alt-click on a
    // visible segment midpoint inserts a point. Both are atomic history
    // operations, not drag gestures, and are implemented by core Scene APIs.
    if (
      tool === "selection" &&
      event.button === 0 &&
      event.altKey &&
      !event.shiftKey &&
      selectedId
    ) {
      const selected = scene.elements.find((element) => element.id === selectedId);
      if (selected && canEditLinearPoints(selected)) {
        const vertex = pickLinearPoint(selected, start, 9 / zoom);
        if (vertex !== null) {
          event.preventDefault();
          if (vertex > 0 && vertex < selected.points.length - 1) {
            const next = deleteLinearMidpoint(scene, selectedId, vertex);
            if (next !== scene) {
              commit(scene, next);
            }
          }
          return;
        }
        const segment = pickLinearSegmentMidpoint(selected, start, 9 / zoom);
        if (segment !== null) {
          event.preventDefault();
          const next = insertLinearMidpoint(scene, selectedId, segment);
          if (next !== scene) {
            commit(scene, next);
          }
          return;
        }
      }
    }
    if (tool === "text" && event.button === 0) {
      // A click normally shifts focus back to the viewport after pointerdown,
      // immediately blurring (and committing) the newly mounted textarea.
      event.preventDefault();
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
    let pointIndex: number | null = null;
    const initialSelection = [...selectedIds];
    let draft: ExcalidrawElement | null = null;

    if (action === "move") {
      const group = !event.shiftKey
        ? transformableGroup(scene, selectedIds)
        : null;
      const groupHandle = group
        ? pickGroupHandle(group.bounds, start, 9 / zoom)
        : null;
      const selected = scene.elements.find((element) => element.id === selectedId);
      endpoint = !event.shiftKey && selected
        ? (pickNativeLinkedEndpoint(scene, selected, start, 9 / zoom) ??
           pickNativeOrbitEndpoint(scene, selected, start, 9 / zoom) ??
           pickElbowEndpoint(selected, start, 9 / zoom)) : null;
      pointIndex = !event.shiftKey && selected && !endpoint
        ? pickLinearPoint(selected, start, 9 / zoom) : null;
      handle = !event.shiftKey && selected
        ? pickHandle(selected, start, 9 / zoom, scene, zoom) : null;
      if (groupHandle && group) {
        action = "group-transform";
        id = group.id;
        handle = groupHandle;
        ids = [...selectedIds];
      } else if ((endpoint || pointIndex !== null) && selectedId) {
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
      latest: scene,
      initialPan: { ...pan },
      id,
      ids,
      handle,
      endpoint,
      pointIndex,
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
        const next = moveSelection(g.original, g.ids, dx, dy);
        if (next !== g.original) {
          g.changed = true;
          g.latest = next;
          onChange(next);
        }
      }
    } else if (g.action === "transform" && g.id && g.handle) {
      if (Math.hypot(dx, dy) > 0.2) {
        const next = transformSelected(g.original, g.id, g.handle, point);
        if (next !== g.original) {
          g.changed = true;
          g.latest = next;
          onChange(next);
        }
      }
    } else if (g.action === "group-transform" && g.id && g.handle) {
      if (Math.hypot(dx, dy) > 0.2) {
        const next = transformGroup(g.original, g.ids, g.handle, point);
        if (next !== g.original) {
          g.changed = true;
          g.latest = next;
          onChange(next);
        }
      }
    } else if (g.action === "endpoint" && g.id &&
               (g.endpoint || g.pointIndex !== null)) {
      if (Math.hypot(dx, dy) > 0.2) {
        const element = g.original.elements.find((item) => item.id === g.id);
        const next = g.endpoint && element &&
          isNativeLinkedArrow(g.original, element)
          ? reconnectNativeEndpoint(g.original, g.id, g.endpoint, point)
          : g.endpoint && element && isNativeOrbitLinkedArrow(g.original, element)
            ? reconnectNativeOrbitEndpoint(g.original, g.id, g.endpoint, point)
          : g.endpoint && element && canEditElbowEndpoints(element)
            ? reconnectNativeOrbitEndpoint(g.original, g.id, g.endpoint, point)
            : g.pointIndex !== null
              ? updateLinearPoint(g.original, g.id, g.pointIndex, point)
              : g.original;
        if (next !== g.original) {
          g.changed = true;
          g.latest = next;
          onChange(next);
        }
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
      (g.action === "move" || g.action === "transform" || g.action === "group-transform" || g.action === "endpoint") &&
      g.changed
    ) {
      // The move was previewed in-place; record the *original* scene once.
      history.commit(g.original, g.latest);
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
      (g.action === "move" || g.action === "transform" || g.action === "group-transform" || g.action === "endpoint") &&
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
    if (!cmd && event.shiftKey && event.key === "!") {
      event.preventDefault();
      fitView("all");
      return;
    }
    if (!cmd && event.shiftKey && event.key === "@") {
      event.preventDefault();
      fitView("selection");
      return;
    }
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
    if (cmd && (event.code === "BracketLeft" || event.code === "BracketRight")) {
      event.preventDefault();
      moveLayer(
        event.code === "BracketLeft"
          ? event.shiftKey ? "bottom" : "back"
          : event.shiftKey ? "top" : "forward",
      );
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
      <button onclick={cropSelectedImage} title="Обрезать изображение по центру до 80% посредством ядра Excalidraw">Обрезать 10%</button>
      {#if selectedRaster.type === "image" && selectedRaster.crop}
        <button onclick={resetSelectedCrop} title="Сбросить обрезку с оригинальной геометрией Excalidraw">Сбросить обрезку</button>
      {/if}
    {/if}
    {#if selectedId && scene.elements.some((element) =>
      element.id === selectedId &&
      element.type === "arrow" &&
      element.points.length === 2 &&
      canEditLinearPoints(element))}
      <button
        onclick={() => {
          if (selectedId) {
            const updated = convertArrowToElbow(scene, selectedId);
            if (updated !== scene) {
              commit(scene, updated);
            }
          }
        }}
        title="Преобразовать обычную стрелку в маршрутизируемую через ядро Excalidraw"
      >↳ Угловая стрелка</button>
    {/if}
    <button disabled={!undoAvailable} onclick={undo} title="Отменить (Ctrl+Z)">↶</button>
    <button disabled={!redoAvailable} onclick={redo} title="Повторить (Ctrl+Shift+Z)">↷</button>
    <button disabled={!selectedIds.length} onclick={duplicate} title="Дублировать (Ctrl+D)">Дублировать</button>
    <button disabled={selectedIds.length < 2} onclick={groupSelected} title="Группировать (Ctrl+G)">Группа</button>
    <button disabled={!selectedIds.length} onclick={ungroupSelected} title="Разгруппировать (Ctrl+Shift+G)">Разгруппа</button>
    {#if layoutAvailable}
      <div class="native-layout-controls" role="group" aria-label="Выравнивание элементов">
        <label>
          Выровнять
          <select
            aria-label="Выравнивание выделенных фигур"
            value=""
            onchange={(event) => {
              const [axis, position] = event.currentTarget.value.split(":");
              if ((axis === "x" || axis === "y") &&
                  (position === "start" || position === "center" || position === "end")) {
                layoutSelection({ kind: "align", alignment: { axis, position } });
              }
              event.currentTarget.value = "";
            }}
          >
            <option value="" disabled>Выбрать</option>
            <option value="x:start">По левому краю</option>
            <option value="x:center">По центру по X</option>
            <option value="x:end">По правому краю</option>
            <option value="y:start">По верхнему краю</option>
            <option value="y:center">По центру по Y</option>
            <option value="y:end">По нижнему краю</option>
          </select>
        </label>
        {#if layoutUnits >= 3}
          <button
            onclick={() => layoutSelection({ kind: "distribute", distribution: { axis: "x", space: "between" } })}
            title="Равномерно распределить по горизонтали"
          >Распределить X</button>
          <button
            onclick={() => layoutSelection({ kind: "distribute", distribution: { axis: "y", space: "between" } })}
            title="Равномерно распределить по вертикали"
          >Распределить Y</button>
        {/if}
      </div>
    {/if}
    {#if layerAvailable}
      <div class="native-layer-controls" role="group" aria-label="Порядок элементов">
        <button onclick={() => moveLayer("bottom")} title="На задний план (Ctrl+Shift+[)">⇤</button>
        <button onclick={() => moveLayer("back")} title="На один слой назад (Ctrl+[)">←</button>
        <button onclick={() => moveLayer("forward")} title="На один слой вперед (Ctrl+])">→</button>
        <button onclick={() => moveLayer("top")} title="На передний план (Ctrl+Shift+])">⇥</button>
      </div>
    {/if}
    {#if styleTarget}
      <div class="native-style-controls" role="group" aria-label="Свойства выделенного элемента">
        {#if styleTarget.type !== "image"}
          <label title="Цвет обводки или текста">
            Цвет
            <input
              type="color"
              aria-label="Цвет обводки"
              value={colorForInput(styleTarget.strokeColor)}
              onchange={(event) => changeStyle({ key: "strokeColor", value: event.currentTarget.value })}
            />
          </label>
        {/if}
        {#if ["rectangle", "ellipse", "diamond", "line"].includes(styleTarget.type)}
          <label>
            Заливка
            <select
              aria-label="Режим заливки"
              value={styleTarget.backgroundColor === "transparent" ? "none" : "color"}
              onchange={(event) => changeStyle({ key: "backgroundColor", value: event.currentTarget.value === "none" ? "transparent" : fillForInput(styleTarget.backgroundColor) })}
            >
              <option value="none">Без заливки</option>
              <option value="color">Цвет</option>
            </select>
            {#if styleTarget.backgroundColor !== "transparent"}
              <input
                type="color"
                aria-label="Цвет заливки"
                value={fillForInput(styleTarget.backgroundColor)}
                onchange={(event) => changeStyle({ key: "backgroundColor", value: event.currentTarget.value })}
              />
              <select
                aria-label="Стиль заливки"
                value={styleTarget.fillStyle}
                onchange={(event) => changeStyle({ key: "fillStyle", value: event.currentTarget.value as "hachure" | "cross-hatch" | "solid" | "zigzag" })}
              >
                <option value="hachure">Штриховка</option>
                <option value="cross-hatch">Сетка</option>
                <option value="solid">Сплошная</option>
                <option value="zigzag">Зигзаг</option>
              </select>
            {/if}
          </label>
        {/if}
        {#if styleTarget.type !== "image" && styleTarget.type !== "text"}
          <label>
            Линия
            <select
              aria-label="Толщина линии"
              value={styleTarget.strokeWidth}
              onchange={(event) => changeStyle({ key: "strokeWidth", value: Number(event.currentTarget.value) as 1 | 2 | 4 })}
            >
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="4">4</option>
            </select>
          </label>
          <label>
            Стиль
            <select
              aria-label="Стиль линии"
              value={styleTarget.strokeStyle}
              onchange={(event) => changeStyle({ key: "strokeStyle", value: event.currentTarget.value as "solid" | "dashed" | "dotted" })}
            >
              <option value="solid">Сплошная</option>
              <option value="dashed">Штрих</option>
              <option value="dotted">Точки</option>
            </select>
          </label>
          <label>
            Эскиз
            <select
              aria-label="Неровность линии"
              value={styleTarget.roughness}
              onchange={(event) => changeStyle({ key: "roughness", value: Number(event.currentTarget.value) as 0 | 1 | 2 })}
            >
              <option value="0">Нет</option>
              <option value="1">Обычно</option>
              <option value="2">Сильно</option>
            </select>
          </label>
        {/if}
        {#if ["rectangle", "diamond", "line", "image"].includes(styleTarget.type)}
          <label>
            Углы
            <select
              aria-label="Скругление углов"
              value={styleTarget.roundness ? "round" : "sharp"}
              onchange={(event) => changeStyle({ key: "roundness", value: event.currentTarget.value as "round" | "sharp" })}
            >
              <option value="sharp">Острые</option>
              <option value="round">Скругленные</option>
            </select>
          </label>
        {/if}
        {#if styleTarget.type === "arrow" && !styleTarget.elbowed}
          <label>
            Начало
            <select
              aria-label="Начальный наконечник стрелки"
              value={styleTarget.startArrowhead ?? "none"}
              onchange={(event) => changeStyle({ key: "startArrowhead", value: event.currentTarget.value === "none" ? null : event.currentTarget.value as "arrow" | "triangle" | "bar" | "circle" | "diamond" })}
            >
              <option value="none">Нет</option>
              <option value="arrow">Стрелка</option>
              <option value="triangle">Треугольник</option>
              <option value="bar">Черта</option>
              <option value="circle">Круг</option>
              <option value="diamond">Ромб</option>
            </select>
          </label>
          <label>
            Конец
            <select
              aria-label="Наконечник стрелки"
              value={styleTarget.endArrowhead ?? "none"}
              onchange={(event) => changeStyle({ key: "endArrowhead", value: event.currentTarget.value === "none" ? null : event.currentTarget.value as "arrow" | "triangle" | "bar" | "circle" | "diamond" })}
            >
              <option value="none">Нет</option>
              <option value="arrow">Стрелка</option>
              <option value="triangle">Треугольник</option>
              <option value="bar">Черта</option>
              <option value="circle">Круг</option>
              <option value="diamond">Ромб</option>
            </select>
          </label>
        {/if}
        <label>
          Прозрачность {styleTarget.opacity}%
          <input
            type="range"
            min="0"
            max="100"
            step="10"
            value={styleTarget.opacity}
            aria-label="Непрозрачность"
            onchange={(event) => changeStyle({ key: "opacity", value: Number(event.currentTarget.value) })}
          />
        </label>
      </div>
    {/if}
    {#if typographyTarget}
      <div class="native-typography-controls" role="group" aria-label="Оформление текста">
        <label>
          Шрифт
          <select
            aria-label="Семейство шрифта"
            value={typographyTarget.fontFamily}
            onchange={(event) => changeTypography({ key: "fontFamily", value: Number(event.currentTarget.value) as FontFamilyValues })}
          >
            <option value={FONT_FAMILY.Excalifont}>Excalifont</option>
            <option value={FONT_FAMILY.Virgil}>Virgil</option>
            <option value={FONT_FAMILY.Helvetica}>Helvetica</option>
            <option value={FONT_FAMILY.Cascadia}>Cascadia</option>
            <option value={FONT_FAMILY.Nunito}>Nunito</option>
          </select>
        </label>
        <label>
          Размер
          <select
            aria-label="Размер шрифта"
            value={typographyTarget.fontSize}
            onchange={(event) => changeTypography({ key: "fontSize", value: Number(event.currentTarget.value) })}
          >
            {#each [12, 16, 20, 24, 28, 36, 48, 64, 72] as size}
              <option value={size}>{size}</option>
            {/each}
          </select>
        </label>
        <label>
          Выравнивание
          <select
            aria-label="Выравнивание текста"
            value={typographyTarget.textAlign}
            onchange={(event) => changeTypography({ key: "textAlign", value: event.currentTarget.value as ExcalidrawTextElement["textAlign"] })}
          >
            <option value="left">Слева</option>
            <option value="center">По центру</option>
            <option value="right">Справа</option>
          </select>
        </label>
      </div>
    {/if}
    <span class="zoom">{Math.round(zoom * 100)}%</span>
    {#if selectedIds.length > 1}<span class="zoom">Выделено: {selectedIds.length}</span>{/if}
    {#if selectedId && scene.elements.some((element) => element.id === selectedId && canEditLinearPoints(element))}
      <span class="zoom">Alt+клик: добавить точку на маркере сегмента / удалить внутренний узел</span>
    {:else if selectedId && scene.elements.some((element) => element.id === selectedId &&
      (canEditElbowEndpoints(element) || isNativeOrbitLinkedArrow(scene, element)))}
      <span class="zoom">Угловая стрелка: перетащите конец на фигуру для orbit-привязки</span>
    {/if}
    <button onclick={() => fitView("all")} title="Показать все объекты (Shift+1)">По содержимому</button>
    <button disabled={!selectedIds.length} onclick={() => fitView("selection")} title="Приблизить выделение (Shift+2)">К выделению</button>
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
    oncopy={copySelected}
    oncut={cutSelected}
    onpaste={pasteSelected}
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
        style:font-size={(textEditor.fontSize * zoom) + "px"}
        style:font-family={getFontFamilyString({ fontFamily: textEditor.fontFamily })}
        style:line-height={String(textEditor.lineHeight)}
        style:text-align={textEditor.textAlign}
        style:width={textEditor.width === null ? undefined : (Math.max(180, textEditor.width * zoom + 8) + "px")}
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
  .native-layout-controls {
    display: flex; gap: 4px; align-items: center;
    padding-left: 6px; border-left: 1px solid #dadae2;
  }
  .native-layout-controls label {
    display: flex; align-items: center; gap: 4px; font-size: 12px;
  }
  .native-layout-controls select { font-size: 12px; max-width: 170px; }
  .native-typography-controls {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    padding: 4px 6px; border-left: 1px solid #dadae2;
  }
  .native-typography-controls label { display: flex; align-items: center; gap: 4px; font-size: 12px; }
  .native-typography-controls select { max-width: 120px; font-size: 12px; }
  .native-layer-controls {
    display: flex; gap: 3px; align-items: center;
    padding-left: 6px; border-left: 1px solid #dadae2;
  }
  .native-style-controls {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    padding: 4px 6px; border-left: 1px solid #dadae2;
  }
  .native-style-controls label {
    display: flex; align-items: center; gap: 4px; white-space: nowrap;
    font-size: 12px;
  }
  .native-style-controls select { max-width: 115px; font-size: 12px; }
  .native-style-controls input[type="color"] { width: 27px; height: 25px; padding: 1px; }
  .native-style-controls input[type="range"] { width: 75px; }
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
