import { newImageElement } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawImageElement,
  FileId,
} from "@excalidraw/element/types";

import type { Point, SceneFile } from "./scene";

export const NATIVE_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

type ImageMime = typeof NATIVE_IMAGE_TYPES[number];
type ImageFile = { id: string; mimeType: ImageMime; dataURL: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isMime = (value: unknown): value is ImageMime =>
  NATIVE_IMAGE_TYPES.some((mime) => mime === value);

/**
 * Only decode embedded raster data URLs. Never load arbitrary external URLs
 * from a scene, and leave unsupported SVG/binary records untouched for React.
 */
export function nativeImageSource(
  scene: SceneFile,
  element: ExcalidrawElement,
): ImageFile | null {
  if (element.type !== "image" || !element.fileId || element.isDeleted) {
    return null;
  }
  const record: unknown = scene.files[element.fileId];
  if (
    !isRecord(record) ||
    !isMime(record.mimeType) ||
    typeof record.dataURL !== "string"
  ) {
    return null;
  }
  const prefix = `data:${record.mimeType};base64,`;
  if (
    !record.dataURL.startsWith(prefix) ||
    record.dataURL.length <= prefix.length
  ) {
    return null;
  }
  return {
    id: element.fileId,
    mimeType: record.mimeType,
    dataURL: record.dataURL,
  };
}

export function addNativeImage(
  scene: SceneFile,
  file: { mimeType: string; dataURL: string },
  dimensions: { width: number; height: number },
  center: Point,
): { scene: SceneFile; element: ExcalidrawImageElement } {
  if (
    !isMime(file.mimeType) ||
    !file.dataURL.startsWith(`data:${file.mimeType};base64,`) ||
    !Number.isFinite(dimensions.width) ||
    !Number.isFinite(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  ) {
    throw new Error("Неподдерживаемое или некорректное изображение.");
  }
  const scale = Math.min(
    1,
    520 / Math.max(dimensions.width, dimensions.height),
  );
  const width = Math.max(1, dimensions.width * scale);
  const height = Math.max(1, dimensions.height * scale);
  const fileId = crypto.randomUUID() as FileId;
  const image = newImageElement({
    type: "image",
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
    fileId,
    status: "saved",
  });
  const now = Date.now();
  return {
    element: image,
    scene: {
      ...scene,
      elements: [...scene.elements, image],
      files: {
        ...scene.files,
        [fileId]: {
          id: fileId,
          mimeType: file.mimeType,
          dataURL: file.dataURL,
          created: now,
        },
      },
    },
  };
}

export function imageSourceRect(
  element: ExcalidrawImageElement,
  naturalWidth: number,
  naturalHeight: number,
): { sx: number; sy: number; sw: number; sh: number } | null {
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return null;
  }
  const c = element.crop;
  if (!c) {
    return { sx: 0, sy: 0, sw: naturalWidth, sh: naturalHeight };
  }
  if (
    ![c.x, c.y, c.width, c.height, c.naturalWidth, c.naturalHeight].every(
      (value) => Number.isFinite(value),
    ) ||
    c.width <= 0 ||
    c.height <= 0 ||
    c.naturalWidth <= 0 ||
    c.naturalHeight <= 0 ||
    c.x < 0 ||
    c.y < 0 ||
    c.x + c.width > c.naturalWidth ||
    c.y + c.height > c.naturalHeight
  ) {
    return null;
  }
  return {
    sx: (c.x / c.naturalWidth) * naturalWidth,
    sy: (c.y / c.naturalHeight) * naturalHeight,
    sw: (c.width / c.naturalWidth) * naturalWidth,
    sh: (c.height / c.naturalHeight) * naturalHeight,
  };
}

export function paintNativeImage(
  ctx: CanvasRenderingContext2D,
  element: ExcalidrawImageElement,
  image: HTMLImageElement | null,
): boolean {
  if (
    !image ||
    element.isDeleted ||
    element.width <= 0 ||
    element.height <= 0
  ) {
    return false;
  }
  const rect = imageSourceRect(
    element,
    image.naturalWidth,
    image.naturalHeight,
  );
  if (!rect) {
    return false;
  }
  ctx.save();
  ctx.globalAlpha = element.opacity / 100;
  ctx.translate(element.x + element.width / 2, element.y + element.height / 2);
  ctx.rotate(element.angle);
  ctx.scale(
    element.scale?.[0] === -1 ? -1 : 1,
    element.scale?.[1] === -1 ? -1 : 1,
  );
  ctx.drawImage(
    image,
    rect.sx,
    rect.sy,
    rect.sw,
    rect.sh,
    -element.width / 2,
    -element.height / 2,
    element.width,
    element.height,
  );
  ctx.restore();
  return true;
}

type CachedImage = {
  source: string;
  image: HTMLImageElement;
  status: "loading" | "ready" | "error";
};

/** Scene-scoped raster cache: reuse decoded images, invalidate on file change. */
export class NativeImageCache {
  private readonly cache = new Map<string, CachedImage>();

  constructor(
    private readonly createImage: () => HTMLImageElement = () => new Image(),
  ) {}

  sync(scene: SceneFile, onReady: () => void): void {
    const used = new Set<string>();
    for (const element of scene.elements) {
      const source = nativeImageSource(scene, element);
      if (!source) {
        continue;
      }
      used.add(source.id);
      const old = this.cache.get(source.id);
      if (old?.source === source.dataURL) {
        continue;
      }
      const image = this.createImage();
      const cached: CachedImage = {
        source: source.dataURL,
        image,
        status: "loading",
      };
      this.cache.set(source.id, cached);
      image.onload = () => {
        if (this.cache.get(source.id) === cached) {
          cached.status = "ready";
          onReady();
        }
      };
      image.onerror = () => {
        if (this.cache.get(source.id) === cached) {
          cached.status = "error";
          onReady();
        }
      };
      image.src = source.dataURL;
    }
    for (const id of this.cache.keys()) {
      if (!used.has(id)) {
        this.cache.delete(id);
      }
    }
  }

  get(id: string | null): HTMLImageElement | null {
    if (!id) {
      return null;
    }
    const entry = this.cache.get(id);
    return entry?.status === "ready" ? entry.image : null;
  }

  clear(): void {
    this.cache.clear();
  }
}
