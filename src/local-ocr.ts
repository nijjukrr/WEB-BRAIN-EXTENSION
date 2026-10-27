import type { BoundingBox, NormalizedElement } from "./dom-perception";
import type { PiiDetection, PiiType, Sensitivity } from "./pii-detector";
import { isAadhaarLikeValue, passesLuhn, PII_PATTERNS } from "./pii-detector";
import { redactLocalContext, type RedactionOutput } from "./redaction-engine";

export type OcrToken = {
  text: string;
  bbox: BoundingBox;
  confidence: number;
};

export type LocalOcrProvider = {
  recognize(image: string): Promise<OcrToken[]>;
};

export type OcrPrivacyResult = {
  ocrDetections: PiiDetection[];
  redactionOutput: RedactionOutput;
};

type OcrRule = {
  type: PiiType;
  sensitivity: Sensitivity;
  confidence: number;
  matches(text: string): boolean;
};

type TesseractWord = {
  text?: string;
  confidence?: number;
  bbox?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
};

type TesseractModule = {
  recognize(
    image: string,
    language?: string,
    options?: Record<string, unknown>
  ): Promise<{
    data?: {
      words?: TesseractWord[];
    };
  }>;
};

const OCR_RULES: OcrRule[] = [
  {
    type: "EMAIL",
    sensitivity: "HIGH",
    confidence: 0.92,
    matches(text) {
      return PII_PATTERNS.EMAIL.test(text);
    }
  },
  {
    type: "PHONE",
    sensitivity: "HIGH",
    confidence: 0.9,
    matches(text) {
      return PII_PATTERNS.PHONE.test(text);
    }
  },
  {
    type: "CARD",
    sensitivity: "HIGH",
    confidence: 0.91,
    matches(text) {
      return PII_PATTERNS.CARD.test(text) && passesLuhn(text);
    }
  },
  {
    type: "AADHAAR",
    sensitivity: "HIGH",
    confidence: 0.9,
    matches(text) {
      return isAadhaarLikeValue(text);
    }
  },
  {
    type: "PAN",
    sensitivity: "HIGH",
    confidence: 0.9,
    matches(text) {
      return PII_PATTERNS.PAN.test(text);
    }
  },
  {
    type: "UPI",
    sensitivity: "HIGH",
    confidence: 0.9,
    matches(text) {
      return PII_PATTERNS.UPI.test(text);
    }
  },
  {
    type: "API_KEY",
    sensitivity: "HIGH",
    confidence: 0.88,
    matches(text) {
      return PII_PATTERNS.API_KEY.test(text);
    }
  }
];

function normalizeOcrText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

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

function ocrElement(token: OcrToken, index: number): NormalizedElement {
  return {
    id: `ocr_element_${index + 1}`,
    tag: "ocr-text",
    domId: null,
    classes: [],
    type: null,
    name: null,
    placeholder: null,
    autocomplete: null,
    ariaLabel: null,
    label: null,
    role: "text",
    text: null,
    bbox: cloneBox(token.bbox),
    visible: true,
    enabled: false
  };
}

function classifyOcrToken(token: OcrToken, index: number): PiiDetection[] {
  const text = normalizeOcrText(token.text);
  if (!text) {
    return [];
  }

  const elementId = `ocr_element_${index + 1}`;

  return OCR_RULES.filter((rule) => rule.matches(text)).map((rule) => ({
    type: rule.type,
    elementId,
    bbox: cloneBox(token.bbox),
    confidence: Math.min(rule.confidence, Math.max(0, token.confidence)),
    sensitivity: rule.sensitivity,
    evidence: ["local-ocr-pattern"]
  }));
}

function toBox(word: TesseractWord): BoundingBox | null {
  if (!word.bbox) {
    return null;
  }

  const width = word.bbox.x1 - word.bbox.x0;
  const height = word.bbox.y1 - word.bbox.y0;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: word.bbox.x0,
    y: word.bbox.y0,
    width,
    height,
    top: word.bbox.y0,
    right: word.bbox.x1,
    bottom: word.bbox.y1,
    left: word.bbox.x0
  };
}

export function classifyOcrTokens(tokens: OcrToken[]): { elements: NormalizedElement[]; detections: PiiDetection[] } {
  return {
    elements: tokens.map(ocrElement),
    detections: tokens.flatMap(classifyOcrToken)
  };
}

export function createTesseractLocalOcrProvider(language = "eng"): LocalOcrProvider {
  return {
    async recognize(image: string): Promise<OcrToken[]> {
      const tesseract = (await import("tesseract.js")) as TesseractModule;
      const result = await tesseract.recognize(image, language, {
        logger: undefined
      });

      return (result.data?.words ?? []).flatMap((word) => {
        const text = normalizeOcrText(word.text ?? "");
        const bbox = toBox(word);

        if (!text || !bbox) {
          return [];
        }

        return [
          {
            text,
            bbox,
            confidence: Math.max(0, Math.min(1, (word.confidence ?? 0) / 100))
          }
        ];
      });
    }
  };
}

export async function redactScreenshotWithLocalOcr(input: {
  screenshot: string;
  domElements: NormalizedElement[];
  domDetections: PiiDetection[];
  ocrProvider: LocalOcrProvider;
}): Promise<OcrPrivacyResult> {
  const tokens = await input.ocrProvider.recognize(input.screenshot);
  const ocr = classifyOcrTokens(tokens);
  const redactionOutput = await redactLocalContext({
    screenshot: input.screenshot,
    elements: [...input.domElements, ...ocr.elements],
    detections: [...input.domDetections, ...ocr.detections]
  });

  return {
    ocrDetections: ocr.detections,
    redactionOutput
  };
}
