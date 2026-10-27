import type { BoundingBox, NormalizedElement } from "./dom-perception";
import type { PiiDetection, PiiType, Sensitivity } from "./pii-detector";

export type VisionBackend = "webgpu" | "wasm" | "cpu";

export type VisionModelMetrics = {
  backend: VisionBackend;
  preprocessingMs: number;
  inferenceMs: number;
  postprocessingMs: number;
  totalMs: number;
  memoryBytes: number | null;
};

export type VisionProviderResult = {
  elements: NormalizedElement[];
  detections: PiiDetection[];
  metrics: VisionModelMetrics;
};

export type LocalVisionProvider = {
  backend: VisionBackend;
  detect(screenshot: string): Promise<VisionProviderResult>;
};

type PixelRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ColorRegionRule = {
  type: PiiType;
  sensitivity: Sensitivity;
  confidence: number;
  color: [number, number, number];
  tolerance: number;
};

type TensorLike = {
  data: Float32Array;
  dims: number[];
};

type OnnxRuntime = {
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => TensorLike;
  InferenceSession: {
    create(modelUrl: string, options: { executionProviders: string[] }): Promise<{
      inputNames: string[];
      outputNames: string[];
      run(feeds: Record<string, TensorLike>): Promise<Record<string, TensorLike>>;
    }>;
  };
};

export type OnnxVisionModelConfig = {
  modelUrl: string;
  inputWidth: number;
  inputHeight: number;
  labels: Record<number, PiiType>;
  confidenceThreshold?: number;
  backend?: VisionBackend;
};

function now(): number {
  return performance.now();
}

function memoryBytes(): number | null {
  const perf = performance as Performance & { memory?: { usedJSHeapSize?: number } };
  return typeof perf.memory?.usedJSHeapSize === "number" ? perf.memory.usedJSHeapSize : null;
}

function emptyMetrics(backend: VisionBackend, startedAt: number): VisionModelMetrics {
  return {
    backend,
    preprocessingMs: 0,
    inferenceMs: 0,
    postprocessingMs: 0,
    totalMs: now() - startedAt,
    memoryBytes: memoryBytes()
  };
}

function boxFromRegion(region: PixelRegion): BoundingBox {
  return {
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    top: region.y,
    right: region.x + region.width,
    bottom: region.y + region.height,
    left: region.x
  };
}

function visionElement(rule: ColorRegionRule, region: PixelRegion, index: number): NormalizedElement {
  return {
    id: `vision_element_${index + 1}`,
    tag: "vision-region",
    domId: null,
    classes: [],
    type: null,
    name: null,
    placeholder: null,
    autocomplete: null,
    ariaLabel: null,
    label: rule.type,
    role: "image",
    text: null,
    bbox: boxFromRegion(region),
    visible: true,
    enabled: false
  };
}

function detectionForVisionElement(element: NormalizedElement, rule: ColorRegionRule): PiiDetection {
  return {
    type: rule.type,
    elementId: element.id,
    bbox: element.bbox,
    confidence: rule.confidence,
    sensitivity: rule.sensitivity,
    evidence: [`local-vision-${rule.type.toLowerCase()}`]
  };
}

function resolveBackend(preferred?: VisionBackend): VisionBackend {
  if (preferred) {
    return preferred;
  }

  const maybeNavigator = globalThis.navigator as Navigator & { gpu?: unknown };
  return maybeNavigator?.gpu ? "webgpu" : "wasm";
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getCanvas2d(canvas: HTMLCanvasElement | OffscreenCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Unable to create 2D canvas context for local vision preprocessing.");
  }

  return context;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load screenshot for local vision."));
    image.src = src;
  });
}

function isSvgDataUrl(dataUrl: string): boolean {
  return dataUrl.startsWith("data:image/svg+xml");
}

function decodeSvg(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) {
    return null;
  }

  const prefix = dataUrl.slice(0, comma + 1);
  const payload = dataUrl.slice(comma + 1);
  return /;base64,/i.test(prefix) ? atob(payload) : decodeURIComponent(payload);
}

function parseRgb(value: string | null): [number, number, number] | null {
  if (!value) {
    return null;
  }

  const hex = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (!hex) {
    return null;
  }

  return [
    Number.parseInt(hex[1].slice(0, 2), 16),
    Number.parseInt(hex[1].slice(2, 4), 16),
    Number.parseInt(hex[1].slice(4, 6), 16)
  ];
}

function sameColor(a: [number, number, number], b: [number, number, number], tolerance: number): boolean {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= tolerance;
}

function findSvgColorRegion(screenshot: string, rule: ColorRegionRule): PixelRegion | null {
  const svg = decodeSvg(screenshot);
  if (!svg || !globalThis.DOMParser) {
    return null;
  }

  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const regions = Array.from(doc.querySelectorAll("rect")).flatMap((rect) => {
    const color = parseRgb(rect.getAttribute("fill"));
    if (!color || !sameColor(color, rule.color, rule.tolerance)) {
      return [];
    }

    const x = Number(rect.getAttribute("x") ?? 0);
    const y = Number(rect.getAttribute("y") ?? 0);
    const width = Number(rect.getAttribute("width"));
    const height = Number(rect.getAttribute("height"));

    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      return [];
    }

    return [{ x, y, width, height }];
  });

  if (regions.length === 0) {
    return null;
  }

  const left = Math.min(...regions.map((region) => region.x));
  const top = Math.min(...regions.map((region) => region.y));
  const right = Math.max(...regions.map((region) => region.x + region.width));
  const bottom = Math.max(...regions.map((region) => region.y + region.height));

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

async function imageDataFromScreenshot(screenshot: string, width?: number, height?: number): Promise<ImageData> {
  const image = await loadImage(screenshot);
  const targetWidth = width ?? image.naturalWidth ?? image.width;
  const targetHeight = height ?? image.naturalHeight ?? image.height;
  const canvas = createCanvas(targetWidth, targetHeight);
  const context = getCanvas2d(canvas);

  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  return context.getImageData(0, 0, targetWidth, targetHeight);
}

function colorDistance(pixel: Uint8ClampedArray, offset: number, color: [number, number, number]): number {
  return (
    Math.abs(pixel[offset] - color[0]) +
    Math.abs(pixel[offset + 1] - color[1]) +
    Math.abs(pixel[offset + 2] - color[2])
  );
}

function findColorRegion(image: ImageData, rule: ColorRegionRule): PixelRegion | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let count = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const alpha = image.data[offset + 3];
      if (alpha > 0 && colorDistance(image.data, offset, rule.color) <= rule.tolerance) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        count += 1;
      }
    }
  }

  if (count === 0) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

function tensorFromImageData(image: ImageData): Float32Array {
  const tensor = new Float32Array(3 * image.width * image.height);
  const planeSize = image.width * image.height;

  for (let index = 0; index < planeSize; index += 1) {
    const pixelOffset = index * 4;
    tensor[index] = image.data[pixelOffset] / 255;
    tensor[planeSize + index] = image.data[pixelOffset + 1] / 255;
    tensor[planeSize * 2 + index] = image.data[pixelOffset + 2] / 255;
  }

  return tensor;
}

function parseOnnxDetections(
  output: TensorLike,
  labels: Record<number, PiiType>,
  confidenceThreshold: number
): Array<{ bbox: BoundingBox; type: PiiType; confidence: number }> {
  const rows = output.dims.at(-2) ?? 0;
  const cols = output.dims.at(-1) ?? 0;

  if (cols < 6) {
    return [];
  }

  const detections: Array<{ bbox: BoundingBox; type: PiiType; confidence: number }> = [];

  for (let row = 0; row < rows; row += 1) {
    const offset = row * cols;
    const confidence = output.data[offset + 4];
    const classId = Math.round(output.data[offset + 5]);
    const type = labels[classId];

    if (!type || confidence < confidenceThreshold) {
      continue;
    }

    const x = output.data[offset];
    const y = output.data[offset + 1];
    const width = output.data[offset + 2];
    const height = output.data[offset + 3];

    detections.push({
      type,
      confidence,
      bbox: {
        x,
        y,
        width,
        height,
        top: y,
        right: x + width,
        bottom: y + height,
        left: x
      }
    });
  }

  return detections;
}

export function createColorRegionVisionProvider(rules: ColorRegionRule[], backend: VisionBackend = "cpu"): LocalVisionProvider {
  return {
    backend,
    async detect(screenshot: string): Promise<VisionProviderResult> {
      const startedAt = now();
      const preprocessStart = now();
      const image = isSvgDataUrl(screenshot) ? null : await imageDataFromScreenshot(screenshot);
      const preprocessingMs = now() - preprocessStart;
      const inferenceStart = now();
      const regions = rules.flatMap((rule) => {
        const region = image ? findColorRegion(image, rule) : findSvgColorRegion(screenshot, rule);
        return region ? [{ rule, region }] : [];
      });
      const inferenceMs = now() - inferenceStart;
      const postprocessStart = now();
      const elements = regions.map(({ rule, region }, index) => visionElement(rule, region, index));
      const detections = elements.map((element, index) => detectionForVisionElement(element, regions[index].rule));
      const postprocessingMs = now() - postprocessStart;

      return {
        elements,
        detections,
        metrics: {
          backend,
          preprocessingMs,
          inferenceMs,
          postprocessingMs,
          totalMs: now() - startedAt,
          memoryBytes: memoryBytes()
        }
      };
    }
  };
}

export function createOnnxLocalVisionProvider(config: OnnxVisionModelConfig): LocalVisionProvider {
  const backend = resolveBackend(config.backend);
  const confidenceThreshold = config.confidenceThreshold ?? 0.5;

  return {
    backend,
    async detect(screenshot: string): Promise<VisionProviderResult> {
      const startedAt = now();
      const preprocessStart = now();
      const image = await imageDataFromScreenshot(screenshot, config.inputWidth, config.inputHeight);
      const input = tensorFromImageData(image);
      const preprocessingMs = now() - preprocessStart;
      const inferenceStart = now();
      const ort = (await import("onnxruntime-web")) as unknown as OnnxRuntime;
      const executionProviders = backend === "webgpu" ? ["webgpu", "wasm"] : ["wasm"];
      const session = await ort.InferenceSession.create(config.modelUrl, { executionProviders });
      const feeds = {
        [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, config.inputHeight, config.inputWidth])
      };
      const results = await session.run(feeds);
      const inferenceMs = now() - inferenceStart;
      const postprocessStart = now();
      const output = results[session.outputNames[0]];
      const parsed = output ? parseOnnxDetections(output, config.labels, confidenceThreshold) : [];
      const elements = parsed.map(({ bbox, type }, index) => visionElement(
        {
          type,
          sensitivity: "HIGH",
          confidence: parsed[index].confidence,
          color: [0, 0, 0],
          tolerance: 0
        },
        bbox,
        index
      ));
      const detections = elements.map((element, index) => ({
        type: parsed[index].type,
        elementId: element.id,
        bbox: element.bbox,
        confidence: parsed[index].confidence,
        sensitivity: "HIGH" as Sensitivity,
        evidence: [`local-vision-onnx-${backend}`]
      }));
      const postprocessingMs = now() - postprocessStart;

      return {
        elements,
        detections,
        metrics: {
          backend,
          preprocessingMs,
          inferenceMs,
          postprocessingMs,
          totalMs: now() - startedAt,
          memoryBytes: memoryBytes()
        }
      };
    }
  };
}

export async function detectVisualPii(screenshot: string, provider: LocalVisionProvider): Promise<VisionProviderResult> {
  return provider.detect(screenshot).catch((error: unknown) => ({
    elements: [],
    detections: [],
    metrics: emptyMetrics(provider.backend, now()),
    error: error instanceof Error ? error.message : "Local vision detection failed."
  }) as VisionProviderResult);
}
