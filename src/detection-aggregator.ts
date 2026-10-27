import type { PiiDetection } from "./pii-detector";

export type DetectionSource = "dom" | "ocr" | "vision";

export type SourcedDetection = PiiDetection & {
  source: DetectionSource;
};

function area(box: PiiDetection["bbox"]): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

function intersectionOverUnion(a: PiiDetection["bbox"], b: PiiDetection["bbox"]): number {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = area(a) + area(b) - intersection;
  return union > 0 ? intersection / union : 0;
}

function priority(source: DetectionSource): number {
  switch (source) {
    case "dom":
      return 3;
    case "ocr":
      return 2;
    case "vision":
      return 1;
  }
}

function better(a: SourcedDetection, b: SourcedDetection): SourcedDetection {
  if (a.confidence !== b.confidence) {
    return a.confidence > b.confidence ? a : b;
  }

  return priority(a.source) >= priority(b.source) ? a : b;
}

export function aggregateDetections(input: {
  dom: PiiDetection[];
  ocr: PiiDetection[];
  vision: PiiDetection[];
  iouThreshold?: number;
}): SourcedDetection[] {
  const iouThreshold = input.iouThreshold ?? 0.75;
  const sourced: SourcedDetection[] = [
    ...input.dom.map((detection) => ({ ...detection, source: "dom" as const })),
    ...input.ocr.map((detection) => ({ ...detection, source: "ocr" as const })),
    ...input.vision.map((detection) => ({ ...detection, source: "vision" as const }))
  ];
  const aggregated: SourcedDetection[] = [];

  for (const detection of sourced) {
    const existingIndex = aggregated.findIndex(
      (candidate) =>
        candidate.type === detection.type &&
        (candidate.elementId === detection.elementId || intersectionOverUnion(candidate.bbox, detection.bbox) >= iouThreshold)
    );

    if (existingIndex === -1) {
      aggregated.push(detection);
      continue;
    }

    aggregated[existingIndex] = better(aggregated[existingIndex], detection);
  }

  return aggregated;
}
