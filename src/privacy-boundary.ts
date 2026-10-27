import type { NormalizedElement } from "./dom-perception";
import type { PiiDetection } from "./pii-detector";
import type { RedactionOutput } from "./redaction-engine";
import type { AdaptiveTransmissionPayload } from "./transmission-policy";

export type NetworkRequestAudit = {
  id: string;
  url: string;
  method: string;
  blocked: boolean;
  reason: string | null;
  payloadSize: number;
};

export type PrivacyTestReport = {
  capturedElements: number;
  sensitiveElements: number;
  redacted: number;
  blocked: number;
  networkRequests: NetworkRequestAudit[];
  rawPiiLeakageCount: number;
  sanitizedPayloadSize: number;
};

export type BoundaryVerificationInput = {
  elements: NormalizedElement[];
  detections: PiiDetection[];
  redactionOutput: RedactionOutput;
  adaptivePayload?: AdaptiveTransmissionPayload;
  rawScreenshot?: string | null;
  rawDom?: string | null;
  rawPiiValues?: string[];
};

export type BoundaryVerificationResult = {
  ok: boolean;
  payload: SanitizedBoundaryPayload | null;
  report: PrivacyTestReport;
  violations: string[];
};

export type SanitizedBoundaryPayload = {
  boundary: "SANITIZED_CONTEXT_ONLY";
  contextRepresentation?: AdaptiveTransmissionPayload["contextRepresentation"];
  userTask?: string;
  sanitizedScreenshot?: string | null;
  sanitizedElements: RedactionOutput["sanitizedElements"];
  sanitizedElementMap?: RedactionOutput["sanitizedElements"];
  allowedInteractions?: AdaptiveTransmissionPayload["allowedInteractions"];
  redactions: RedactionOutput["redactions"];
};

type TransportResult = {
  ok: boolean;
  status?: number;
};

type SanitizedTransport = (request: {
  url: string;
  method: string;
  body: string;
}) => Promise<TransportResult>;

let requestCounter = 0;

function serializedSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function createPayload(input: BoundaryVerificationInput): SanitizedBoundaryPayload {
  if (input.adaptivePayload) {
    return {
      boundary: input.adaptivePayload.boundary,
      contextRepresentation: input.adaptivePayload.contextRepresentation,
      userTask: input.adaptivePayload.userTask,
      sanitizedScreenshot: input.adaptivePayload.sanitizedScreenshot,
      sanitizedElements: input.adaptivePayload.sanitizedElementMap,
      sanitizedElementMap: input.adaptivePayload.sanitizedElementMap,
      allowedInteractions: input.adaptivePayload.allowedInteractions,
      redactions: input.adaptivePayload.redactions
    };
  }

  return {
    boundary: "SANITIZED_CONTEXT_ONLY",
    contextRepresentation: "screenshot_with_element_map",
    sanitizedScreenshot: input.redactionOutput.sanitizedScreenshot,
    sanitizedElements: input.redactionOutput.sanitizedElements,
    redactions: input.redactionOutput.redactions
  };
}

function uniqueSensitiveElementCount(detections: PiiDetection[]): number {
  return new Set(detections.map((detection) => detection.elementId)).size;
}

function nonEmptySecrets(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let start = 0;

  while (needle.length > 0) {
    const index = haystack.indexOf(needle, start);
    if (index === -1) {
      return count;
    }

    count += 1;
    start = index + needle.length;
  }

  return count;
}

function countRawLeaks(serializedPayload: string, input: BoundaryVerificationInput): number {
  let leaks = 0;

  for (const rawValue of nonEmptySecrets(input.rawPiiValues)) {
    leaks += countOccurrences(serializedPayload, rawValue);
  }

  if (input.rawScreenshot && serializedPayload.includes(input.rawScreenshot)) {
    leaks += 1;
  }

  if (input.rawDom && serializedPayload.includes(input.rawDom)) {
    leaks += 1;
  }

  return leaks;
}

function findViolations(input: BoundaryVerificationInput, payload: SanitizedBoundaryPayload): string[] {
  const violations: string[] = [];
  const serializedPayload = JSON.stringify(payload);
  const rawLeakCount = countRawLeaks(serializedPayload, input);
  const redactedElementIds = new Set(input.redactionOutput.redactions.map((redaction) => redaction.elementId));
  const sensitiveElementIds = new Set(input.detections.map((detection) => detection.elementId));

  if (rawLeakCount > 0) {
    violations.push("raw-pii-leakage");
  }

  if (input.detections.length > 0 && input.redactionOutput.redactions.length === 0) {
    violations.push("missing-redactions");
  }

  for (const elementId of sensitiveElementIds) {
    if (!redactedElementIds.has(elementId)) {
      violations.push("sensitive-element-not-redacted");
      break;
    }
  }

  if (payload.boundary !== "SANITIZED_CONTEXT_ONLY") {
    violations.push("invalid-boundary-marker");
  }

  return violations;
}

function baseReport(input: BoundaryVerificationInput, payload: SanitizedBoundaryPayload, rawLeakCount: number): PrivacyTestReport {
  return {
    capturedElements: input.elements.length,
    sensitiveElements: uniqueSensitiveElementCount(input.detections),
    redacted: input.redactionOutput.redactions.length,
    blocked: 0,
    networkRequests: [],
    rawPiiLeakageCount: rawLeakCount,
    sanitizedPayloadSize: serializedSize(payload)
  };
}

export function verifyPrivacyBoundary(input: BoundaryVerificationInput): BoundaryVerificationResult {
  const payload = createPayload(input);
  const rawLeakCount = countRawLeaks(JSON.stringify(payload), input);
  const violations = findViolations(input, payload);
  const report = baseReport(input, payload, rawLeakCount);

  return {
    ok: violations.length === 0,
    payload: violations.length === 0 ? payload : null,
    report,
    violations
  };
}

export async function sendSanitizedThroughBoundary(
  input: BoundaryVerificationInput,
  request: { url: string; method?: string },
  transport: SanitizedTransport
): Promise<BoundaryVerificationResult> {
  const verification = verifyPrivacyBoundary(input);
  const method = request.method ?? "POST";
  const body = verification.payload ? JSON.stringify(verification.payload) : "";
  const audit: NetworkRequestAudit = {
    id: `network_request_${requestCounter + 1}`,
    url: request.url,
    method,
    blocked: !verification.ok,
    reason: verification.ok ? null : verification.violations.join(","),
    payloadSize: body.length
  };

  requestCounter += 1;

  if (!verification.ok || !verification.payload) {
    verification.report.blocked += 1;
    verification.report.networkRequests.push(audit);
    return verification;
  }

  const result = await transport({
    url: request.url,
    method,
    body
  });

  verification.report.networkRequests.push({
    ...audit,
    blocked: !result.ok,
    reason: result.ok ? null : `transport-status-${result.status ?? "unknown"}`
  });

  if (!result.ok) {
    verification.report.blocked += 1;
  }

  return verification;
}

export function installFailClosedNetworkGuard(): void {
  const guardedGlobal = globalThis as typeof globalThis & {
    fetch?: typeof fetch;
    XMLHttpRequest?: typeof XMLHttpRequest;
    navigator?: Navigator & { sendBeacon?: (url: string | URL, data?: BodyInit | null) => boolean };
    __privacyBoundaryGuardInstalled?: boolean;
  };

  if (guardedGlobal.__privacyBoundaryGuardInstalled) {
    return;
  }

  guardedGlobal.__privacyBoundaryGuardInstalled = true;

  if (guardedGlobal.fetch) {
    guardedGlobal.fetch = (() => Promise.reject(new Error("Blocked by privacy boundary: unaudited fetch request."))) as typeof fetch;
  }

  if (guardedGlobal.navigator?.sendBeacon) {
    guardedGlobal.navigator.sendBeacon = () => false;
  }

  if (guardedGlobal.XMLHttpRequest) {
    guardedGlobal.XMLHttpRequest = class BlockedXMLHttpRequest {
      open(): void {
        throw new Error("Blocked by privacy boundary: unaudited XMLHttpRequest.");
      }
    } as unknown as typeof XMLHttpRequest;
  }
}
