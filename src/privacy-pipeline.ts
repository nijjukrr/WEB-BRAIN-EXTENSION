import type { NormalizedElement } from "./dom-perception";
import { inspectDocument } from "./dom-perception";
import { detectPii, detectPiiInDocument, type PiiDetection } from "./pii-detector";
import { classifyOcrTokens, type LocalOcrProvider } from "./local-ocr";
import { detectVisualPii, type LocalVisionProvider, type VisionModelMetrics } from "./local-vision";
import { aggregateDetections, type SourcedDetection } from "./detection-aggregator";
import { redactLocalContext, type RedactionOutput } from "./redaction-engine";

export type UnifiedPrivacyPipelineResult = {
  elements: NormalizedElement[];
  detections: SourcedDetection[];
  redactionOutput: RedactionOutput;
  visionMetrics: VisionModelMetrics | null;
};

export async function runUnifiedPrivacyPipeline(input: {
  screenshot: string;
  document?: Document;
  domElements?: NormalizedElement[];
  domDetections?: PiiDetection[];
  ocrProvider?: LocalOcrProvider;
  visionProvider?: LocalVisionProvider;
}): Promise<UnifiedPrivacyPipelineResult> {
  const domElements = input.domElements ?? (input.document ? inspectDocument(input.document) : []);
  const domDetections = input.domDetections ?? (input.document ? detectPiiInDocument(input.document) : detectPii(domElements));
  const ocr = input.ocrProvider ? classifyOcrTokens(await input.ocrProvider.recognize(input.screenshot)) : { elements: [], detections: [] };
  const vision = input.visionProvider ? await detectVisualPii(input.screenshot, input.visionProvider) : null;
  const allElements = [...domElements, ...ocr.elements, ...(vision?.elements ?? [])];
  const detections = aggregateDetections({
    dom: domDetections,
    ocr: ocr.detections,
    vision: vision?.detections ?? []
  });
  const redactionOutput = await redactLocalContext({
    screenshot: input.screenshot,
    elements: allElements,
    detections
  });

  return {
    elements: allElements,
    detections,
    redactionOutput,
    visionMetrics: vision?.metrics ?? null
  };
}
