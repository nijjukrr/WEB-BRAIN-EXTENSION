import type { BoundingBox } from "./dom-perception";
import type { PiiDetection } from "./pii-detector";
import type { LocalVisionProvider, VisionBackend } from "./local-vision";

export type BenchmarkGroundTruth = {
  type: PiiDetection["type"];
  bbox: BoundingBox;
};

export type DetectionAccuracy = {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
};

export type VisionBenchmarkResult = {
  backend: VisionBackend;
  latencyMs: number;
  preprocessingMs: number;
  inferenceMs: number;
  postprocessingMs: number;
  memoryBytes: number | null;
  detectionAccuracy: DetectionAccuracy;
};

function area(box: BoundingBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

function iou(a: BoundingBox, b: BoundingBox): number {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = area(a) + area(b) - intersection;
  return union > 0 ? intersection / union : 0;
}

export function scoreDetectionAccuracy(
  detections: PiiDetection[],
  groundTruth: BenchmarkGroundTruth[],
  iouThreshold = 0.5
): DetectionAccuracy {
  const matchedTruth = new Set<number>();
  let truePositives = 0;
  let falsePositives = 0;

  for (const detection of detections) {
    const matchIndex = groundTruth.findIndex(
      (truth, index) =>
        !matchedTruth.has(index) &&
        truth.type === detection.type &&
        iou(truth.bbox, detection.bbox) >= iouThreshold
    );

    if (matchIndex === -1) {
      falsePositives += 1;
    } else {
      truePositives += 1;
      matchedTruth.add(matchIndex);
    }
  }

  const falseNegatives = groundTruth.length - matchedTruth.size;
  const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
  const recall = groundTruth.length > 0 ? truePositives / groundTruth.length : 0;

  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall
  };
}

export async function benchmarkVisionProvider(input: {
  screenshot: string;
  provider: LocalVisionProvider;
  groundTruth: BenchmarkGroundTruth[];
}): Promise<VisionBenchmarkResult> {
  const startedAt = performance.now();
  const result = await input.provider.detect(input.screenshot);
  const latencyMs = performance.now() - startedAt;

  return {
    backend: result.metrics.backend,
    latencyMs,
    preprocessingMs: result.metrics.preprocessingMs,
    inferenceMs: result.metrics.inferenceMs,
    postprocessingMs: result.metrics.postprocessingMs,
    memoryBytes: result.metrics.memoryBytes,
    detectionAccuracy: scoreDetectionAccuracy(result.detections, input.groundTruth)
  };
}

export async function benchmarkVisionBackends(input: {
  screenshot: string;
  providers: LocalVisionProvider[];
  groundTruth: BenchmarkGroundTruth[];
}): Promise<VisionBenchmarkResult[]> {
  const results: VisionBenchmarkResult[] = [];

  for (const provider of input.providers) {
    results.push(
      await benchmarkVisionProvider({
        screenshot: input.screenshot,
        provider,
        groundTruth: input.groundTruth
      })
    );
  }

  return results;
}
