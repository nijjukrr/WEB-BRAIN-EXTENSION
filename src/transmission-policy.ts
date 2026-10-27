import type { AgentActionType } from "./backend/schemas";
import type { PiiDetection } from "./pii-detector";
import type { RedactionOutput, SanitizedElement } from "./redaction-engine";

export type ContextRepresentation = "dom_only" | "screenshot_with_element_map" | "focused_visual_context";

export type TransmissionDecisionMetadata = {
  representation: ContextRepresentation;
  reasonCodes: string[];
  capturedElementCount: number;
  transmittedElementCount: number;
  redactionCount: number;
  includesScreenshot: boolean;
  sanitizedPayloadSize: number;
};

export type AllowedInteractionForTransmission = {
  elementId: string;
  actions: AgentActionType[];
  safeText?: string;
};

export type AdaptiveTransmissionPayload = {
  boundary: "SANITIZED_CONTEXT_ONLY";
  contextRepresentation: ContextRepresentation;
  userTask: string;
  sanitizedScreenshot?: string | null;
  sanitizedElementMap: SanitizedElement[];
  allowedInteractions: AllowedInteractionForTransmission[];
  redactions: RedactionOutput["redactions"];
};

const VISUAL_TASK_TERMS = [
  "image",
  "picture",
  "photo",
  "screenshot",
  "canvas",
  "pdf",
  "scanned",
  "document",
  "visual",
  "icon",
  "color",
  "chart",
  "graph",
  "preview",
  "diagram"
];

const COMPLEX_VISUAL_TERMS = ["scanned", "pdf", "document", "chart", "graph", "diagram"];

function normalize(value: string): string {
  return value.toLowerCase();
}

function sizeOf(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function taskContains(task: string, terms: string[]): boolean {
  const normalized = normalize(task);
  return terms.some((term) => normalized.includes(term));
}

function safeElementForTransmission(element: SanitizedElement): SanitizedElement {
  return {
    ...element,
    text: element.redacted ? element.placeholder : element.text,
    bbox: { ...element.bbox },
    classes: []
  };
}

function isRelevantElement(element: SanitizedElement, allowed: Set<string>): boolean {
  return (
    allowed.has(element.id) ||
    element.redacted ||
    element.role === "button" ||
    element.role === "link" ||
    element.role === "heading" ||
    element.role === "textbox" ||
    element.visible
  );
}

function chooseElements(
  representation: ContextRepresentation,
  elements: SanitizedElement[],
  allowedInteractions: AllowedInteractionForTransmission[]
): SanitizedElement[] {
  const allowed = new Set(allowedInteractions.map((interaction) => interaction.elementId));
  const source = representation === "focused_visual_context" ? elements.filter((element) => isRelevantElement(element, allowed)) : elements;
  return source.map(safeElementForTransmission);
}

export function decideContextRepresentation(input: {
  userTask: string;
  sanitizedScreenshot: string | null;
  sanitizedElements: SanitizedElement[];
  detections: PiiDetection[];
}): { representation: ContextRepresentation; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  const hasScreenshot = Boolean(input.sanitizedScreenshot);
  const visualTask = taskContains(input.userTask, VISUAL_TASK_TERMS);
  const complexVisualTask = taskContains(input.userTask, COMPLEX_VISUAL_TERMS);
  const visibleImageLike = input.sanitizedElements.some(
    (element) => element.visible && ["img", "canvas", "svg", "video", "embed", "iframe", "vision-region", "ocr-text"].includes(element.tag)
  );

  if (!hasScreenshot) {
    reasonCodes.push("no-screenshot-available");
    return { representation: "dom_only", reasonCodes };
  }

  if (!visualTask && !visibleImageLike) {
    reasonCodes.push("structured-context-sufficient");
    return { representation: "dom_only", reasonCodes };
  }

  if (complexVisualTask || input.sanitizedElements.length > 50 || input.detections.some((detection) => detection.evidence.includes("local-vision"))) {
    reasonCodes.push("complex-visual-context-required");
    return { representation: "focused_visual_context", reasonCodes };
  }

  reasonCodes.push("visual-context-required");
  return { representation: "screenshot_with_element_map", reasonCodes };
}

export function buildAdaptiveTransmissionPayload(input: {
  userTask: string;
  redactionOutput: RedactionOutput;
  detections: PiiDetection[];
  allowedInteractions: AllowedInteractionForTransmission[];
}): { payload: AdaptiveTransmissionPayload; metadata: TransmissionDecisionMetadata } {
  const decision = decideContextRepresentation({
    userTask: input.userTask,
    sanitizedScreenshot: input.redactionOutput.sanitizedScreenshot,
    sanitizedElements: input.redactionOutput.sanitizedElements,
    detections: input.detections
  });
  const includeScreenshot = decision.representation !== "dom_only";
  const sanitizedElementMap = chooseElements(
    decision.representation,
    input.redactionOutput.sanitizedElements,
    input.allowedInteractions
  );
  const payload: AdaptiveTransmissionPayload = {
    boundary: "SANITIZED_CONTEXT_ONLY",
    contextRepresentation: decision.representation,
    userTask: input.userTask,
    sanitizedScreenshot: includeScreenshot ? input.redactionOutput.sanitizedScreenshot : null,
    sanitizedElementMap,
    allowedInteractions: input.allowedInteractions,
    redactions: input.redactionOutput.redactions
  };

  const metadata: TransmissionDecisionMetadata = {
    representation: decision.representation,
    reasonCodes: decision.reasonCodes,
    capturedElementCount: input.redactionOutput.sanitizedElements.length,
    transmittedElementCount: sanitizedElementMap.length,
    redactionCount: input.redactionOutput.redactions.length,
    includesScreenshot: includeScreenshot,
    sanitizedPayloadSize: sizeOf(payload)
  };

  return { payload, metadata };
}
