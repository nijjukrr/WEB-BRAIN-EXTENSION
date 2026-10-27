import type { BoundingBox, NormalizedElement } from "./dom-perception";
import type { PiiDetection, PiiType, Sensitivity } from "./pii-detector";

export type RedactionMetadata = {
  id: string;
  type: PiiType | "PERSON";
  elementId: string;
  bbox: BoundingBox;
  placeholder: string;
  confidence: number;
  sensitivity: Sensitivity;
};

export type SanitizedElement = NormalizedElement & {
  redacted: boolean;
  placeholder: string | null;
  redactionTypes: Array<PiiType | "PERSON">;
};

export type RedactionInput = {
  screenshot: string;
  elements: NormalizedElement[];
  detections: PiiDetection[];
};

export type RedactionOutput = {
  sanitizedScreenshot: string;
  sanitizedElements: SanitizedElement[];
  redactions: RedactionMetadata[];
};

type PlaceholderType = PiiType | "PERSON";

const TYPE_TO_PLACEHOLDER: Record<PiiType, PlaceholderType> = {
  PASSWORD: "PASSWORD",
  EMAIL: "EMAIL",
  PHONE: "PHONE",
  CARD: "CARD",
  CVV: "CVV",
  OTP: "OTP",
  NAME: "PERSON",
  ADDRESS: "ADDRESS",
  API_KEY: "API_KEY",
  AADHAAR: "AADHAAR",
  PAN: "PAN",
  UPI: "UPI"
};

function cloneBox(box: BoundingBox): BoundingBox {
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    top: box.top,
    right: box.right,
    bottom: box.bottom,
    left: box.left
  };
}

function createPlaceholderFactory(): (type: PiiType) => { normalizedType: PlaceholderType; placeholder: string } {
  const counters = new Map<PlaceholderType, number>();

  return (type: PiiType) => {
    const normalizedType = TYPE_TO_PLACEHOLDER[type];
    const next = (counters.get(normalizedType) ?? 0) + 1;
    counters.set(normalizedType, next);

    return {
      normalizedType,
      placeholder: `<${normalizedType}_${next}>`
    };
  };
}

function buildRedactions(detections: PiiDetection[]): RedactionMetadata[] {
  const nextPlaceholder = createPlaceholderFactory();

  return detections.map((detection, index) => {
    const { normalizedType, placeholder } = nextPlaceholder(detection.type);

    return {
      id: `redaction_${index + 1}`,
      type: normalizedType,
      elementId: detection.elementId,
      bbox: cloneBox(detection.bbox),
      placeholder,
      confidence: detection.confidence,
      sensitivity: detection.sensitivity
    };
  });
}

function sanitizeText(text: string | null, redactions: RedactionMetadata[]): string | null {
  if (!text) {
    return null;
  }

  if (redactions.length === 0) {
    return text;
  }

  return redactions.map((redaction) => redaction.placeholder).join(" ");
}

function sanitizeElements(elements: NormalizedElement[], redactions: RedactionMetadata[]): SanitizedElement[] {
  const redactionsByElement = new Map<string, RedactionMetadata[]>();

  for (const redaction of redactions) {
    const existing = redactionsByElement.get(redaction.elementId) ?? [];
    existing.push(redaction);
    redactionsByElement.set(redaction.elementId, existing);
  }

  return elements.map((element) => {
    const elementRedactions = redactionsByElement.get(element.id) ?? [];

    return {
      ...element,
      bbox: cloneBox(element.bbox),
      text: sanitizeText(element.text, elementRedactions),
      redacted: elementRedactions.length > 0,
      placeholder: elementRedactions[0]?.placeholder ?? null,
      redactionTypes: elementRedactions.map((redaction) => redaction.type)
    };
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isSvgDataUrl(dataUrl: string): boolean {
  return dataUrl.startsWith("data:image/svg+xml");
}

function decodeSvgDataUrl(dataUrl: string): { prefix: string; svg: string; isBase64: boolean } | null {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) {
    return null;
  }

  const prefix = dataUrl.slice(0, comma + 1);
  const payload = dataUrl.slice(comma + 1);
  const isBase64 = /;base64,/i.test(prefix);
  const svg = isBase64 ? atob(payload) : decodeURIComponent(payload);

  return { prefix, svg, isBase64 };
}

function encodeSvgDataUrl(prefix: string, svg: string, isBase64: boolean): string {
  if (isBase64) {
    return `${prefix}${btoa(svg)}`;
  }

  return `${prefix}${encodeURIComponent(svg)}`;
}

function pointInsideBox(x: number, y: number, box: BoundingBox): boolean {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

function textElementPoint(textElement: Element): { x: number; y: number } | null {
  const x = Number(textElement.getAttribute("x"));
  const y = Number(textElement.getAttribute("y"));

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

function redactSvgScreenshot(screenshot: string, redactions: RedactionMetadata[]): string {
  const decoded = decodeSvgDataUrl(screenshot);
  if (!decoded || !globalThis.DOMParser || !globalThis.XMLSerializer) {
    return screenshot;
  }

  const doc = new DOMParser().parseFromString(decoded.svg, "image/svg+xml");
  const svg = doc.documentElement;

  for (const redaction of redactions) {
    for (const text of Array.from(doc.querySelectorAll("text"))) {
      const point = textElementPoint(text);
      if (point && pointInsideBox(point.x, point.y, redaction.bbox)) {
        text.textContent = redaction.placeholder;
      }
    }

    const rect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(redaction.bbox.left));
    rect.setAttribute("y", String(redaction.bbox.top));
    rect.setAttribute("width", String(redaction.bbox.width));
    rect.setAttribute("height", String(redaction.bbox.height));
    rect.setAttribute("fill", "#111827");
    svg.appendChild(rect);

    const label = doc.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", String(redaction.bbox.left + 6));
    label.setAttribute("y", String(redaction.bbox.top + Math.max(16, redaction.bbox.height / 2)));
    label.setAttribute("fill", "#ffffff");
    label.setAttribute("font-family", "Arial, sans-serif");
    label.setAttribute("font-size", "12");
    label.textContent = redaction.placeholder;
    svg.appendChild(label);
  }

  const sanitized = new XMLSerializer().serializeToString(doc);
  return encodeSvgDataUrl(decoded.prefix, sanitized, decoded.isBase64);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load screenshot for redaction."));
    image.src = src;
  });
}

async function redactRasterScreenshot(screenshot: string, redactions: RedactionMetadata[]): Promise<string> {
  if (!globalThis.document) {
    return screenshot;
  }

  const image = await loadImage(screenshot);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create canvas context for redaction.");
  }

  context.drawImage(image, 0, 0);

  for (const redaction of redactions) {
    context.fillStyle = "#111827";
    context.fillRect(redaction.bbox.left, redaction.bbox.top, redaction.bbox.width, redaction.bbox.height);
    context.fillStyle = "#ffffff";
    context.font = "12px Arial, sans-serif";
    context.textBaseline = "middle";
    context.fillText(
      redaction.placeholder,
      redaction.bbox.left + 6,
      redaction.bbox.top + Math.max(10, redaction.bbox.height / 2)
    );
  }

  return canvas.toDataURL("image/png");
}

export function createRedactionMetadata(detections: PiiDetection[]): RedactionMetadata[] {
  return buildRedactions(detections);
}

export function sanitizeElementMap(elements: NormalizedElement[], redactions: RedactionMetadata[]): SanitizedElement[] {
  return sanitizeElements(elements, redactions);
}

export async function redactScreenshot(screenshot: string, redactions: RedactionMetadata[]): Promise<string> {
  if (redactions.length === 0) {
    return screenshot;
  }

  if (isSvgDataUrl(screenshot)) {
    return redactSvgScreenshot(screenshot, redactions);
  }

  return redactRasterScreenshot(screenshot, redactions);
}

export async function redactLocalContext(input: RedactionInput): Promise<RedactionOutput> {
  const redactions = createRedactionMetadata(input.detections);

  return {
    sanitizedScreenshot: await redactScreenshot(input.screenshot, redactions),
    sanitizedElements: sanitizeElementMap(input.elements, redactions),
    redactions
  };
}
