import type { BoundingBox, NormalizedElement } from "./dom-perception";
import { inspectDocument } from "./dom-perception";

export type PiiType =
  | "PASSWORD"
  | "EMAIL"
  | "PHONE"
  | "CARD"
  | "CVV"
  | "OTP"
  | "NAME"
  | "ADDRESS"
  | "API_KEY"
  | "AADHAAR"
  | "PAN"
  | "UPI";

export type Sensitivity = "LOW" | "MEDIUM" | "HIGH";

export type PiiDetection = {
  type: PiiType;
  elementId: string;
  bbox: BoundingBox;
  confidence: number;
  sensitivity: Sensitivity;
  evidence: string[];
};

type DetectorInput = {
  element: NormalizedElement;
  rawValue: string | null;
};

type DetectionRule = {
  type: PiiType;
  confidence: number;
  sensitivity: Sensitivity;
  test(input: DetectorInput): string[];
};

const HIGH: Sensitivity = "HIGH";
const MEDIUM: Sensitivity = "MEDIUM";

export const PII_PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/i,
  PHONE: /(?:\+?91[\s-]?)?[6-9]\d{9}\b/,
  AADHAAR: /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/,
  PAN: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/i,
  UPI: /\b[a-z0-9.\-_]{2,256}@(oksbi|okaxis|okhdfcbank|okicici|ybl|ibl|axl|paytm|apl|upi)\b/i,
  API_KEY: /\b(?:sk|pk|api|key|token|secret|ghp|gho|ghu|github_pat)[A-Za-z0-9_\-]{16,}\b/i,
  CARD: /(?:\d[ -]*?){13,19}/,
  OTP: /\b\d{4,8}\b/
} as const;

function normalize(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function compact(value: string): string {
  return value.replace(/[\s_-]+/g, "").toLowerCase();
}

function metadataText(element: NormalizedElement): string {
  return [
    element.tag,
    element.domId,
    element.classes.join(" "),
    element.type,
    element.name,
    element.placeholder,
    element.autocomplete,
    element.ariaLabel,
    element.label,
    element.role,
    element.text
  ]
    .map(normalize)
    .filter(Boolean)
    .join(" ");
}

function hasAny(value: string, tokens: string[]): boolean {
  const normalized = compact(value);
  return tokens.some((token) => normalized.includes(compact(token)));
}

function hasWholeWord(value: string, token: string): boolean {
  return new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(value);
}

function isFormControl(element: NormalizedElement): boolean {
  return element.tag === "input" || element.tag === "textarea" || element.tag === "select";
}

function readRawValue(sourceElement: Element, win: Window & typeof globalThis): string | null {
  if (sourceElement instanceof win.HTMLInputElement || sourceElement instanceof win.HTMLTextAreaElement) {
    return normalize(sourceElement.value);
  }

  return null;
}

export function passesLuhn(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) {
    return false;
  }

  let sum = 0;
  let doubleDigit = false;

  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }

  return sum % 10 === 0;
}

export function isAadhaarLikeValue(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length === 12 && PII_PATTERNS.AADHAAR.test(value) && !/^(\d)\1{11}$/.test(digits);
}

function isLikelyOtpContext(metadata: string): boolean {
  return hasAny(metadata, ["otp", "one time", "one-time", "verification code", "security code", "auth code", "2fa", "mfa"]);
}

function buildDetection(rule: DetectionRule, input: DetectorInput, evidence: string[]): PiiDetection {
  return {
    type: rule.type,
    elementId: input.element.id,
    bbox: input.element.bbox,
    confidence: rule.confidence,
    sensitivity: rule.sensitivity,
    evidence
  };
}

const rules: DetectionRule[] = [
  {
    type: "PASSWORD",
    confidence: 0.99,
    sensitivity: HIGH,
    test({ element }) {
      const metadata = metadataText(element);
      const evidence: string[] = [];
      if (element.type === "password") evidence.push("input-type");
      if (hasAny(metadata, ["password", "passwd", "passcode", "current-password", "new-password"])) evidence.push("metadata");
      return evidence;
    }
  },
  {
    type: "EMAIL",
    confidence: 0.98,
    sensitivity: HIGH,
    test({ element, rawValue }) {
      const metadata = metadataText(element);
      const evidence: string[] = [];
      if (element.type === "email") evidence.push("input-type");
      if (hasAny(metadata, ["email", "e-mail", "mail id", "mailid"])) evidence.push("metadata");
      if (rawValue && PII_PATTERNS.EMAIL.test(rawValue)) evidence.push("input-value-pattern");
      return evidence;
    }
  },
  {
    type: "PHONE",
    confidence: 0.96,
    sensitivity: HIGH,
    test({ element, rawValue }) {
      const metadata = metadataText(element);
      const evidence: string[] = [];
      if (element.type === "tel") evidence.push("input-type");
      if (hasAny(metadata, ["phone", "mobile", "contact number", "telephone", "whatsapp"])) evidence.push("metadata");
      if (rawValue && PII_PATTERNS.PHONE.test(rawValue)) evidence.push("input-value-pattern");
      return evidence;
    }
  },
  {
    type: "CARD",
    confidence: 0.97,
    sensitivity: HIGH,
    test({ element, rawValue }) {
      const metadata = metadataText(element);
      const evidence: string[] = [];
      if (hasAny(metadata, ["card number", "credit card", "debit card", "cc-number", "payment card"])) evidence.push("metadata");
      if (rawValue && PII_PATTERNS.CARD.test(rawValue) && passesLuhn(rawValue)) evidence.push("input-value-pattern");
      return evidence;
    }
  },
  {
    type: "CVV",
    confidence: 0.98,
    sensitivity: HIGH,
    test({ element }) {
      const metadata = metadataText(element);
      return hasAny(metadata, ["cvv", "cvc", "security code", "card verification"]) ? ["metadata"] : [];
    }
  },
  {
    type: "OTP",
    confidence: 0.95,
    sensitivity: HIGH,
    test({ element, rawValue }) {
      const metadata = metadataText(element);
      const evidence: string[] = [];
      if (isLikelyOtpContext(metadata)) evidence.push("metadata");
      if (rawValue && isLikelyOtpContext(metadata) && PII_PATTERNS.OTP.test(rawValue)) evidence.push("input-value-pattern");
      return evidence;
    }
  },
  {
    type: "NAME",
    confidence: 0.88,
    sensitivity: MEDIUM,
    test({ element }) {
      const metadata = metadataText(element);
      if (!isFormControl(element)) return [];
      return hasAny(metadata, ["full name", "first name", "last name", "customer name", "cardholder name", "recipient name"])
        ? ["metadata"]
        : [];
    }
  },
  {
    type: "ADDRESS",
    confidence: 0.9,
    sensitivity: HIGH,
    test({ element }) {
      const metadata = metadataText(element);
      if (!isFormControl(element)) return [];
      return hasAny(metadata, [
        "address",
        "street",
        "shipping address",
        "billing address",
        "postal code",
        "postcode",
        "zip",
        "pincode",
        "pin code",
        "address line"
      ])
        ? ["metadata"]
        : [];
    }
  },
  {
    type: "API_KEY",
    confidence: 0.94,
    sensitivity: HIGH,
    test({ element, rawValue }) {
      const metadata = metadataText(element);
      const evidence: string[] = [];
      if (hasAny(metadata, ["api key", "apikey", "access token", "secret key", "client secret"])) evidence.push("metadata");
      if (rawValue && PII_PATTERNS.API_KEY.test(rawValue)) evidence.push("input-value-pattern");
      if (element.text && PII_PATTERNS.API_KEY.test(element.text)) evidence.push("visible-text-pattern");
      return evidence;
    }
  },
  {
    type: "AADHAAR",
    confidence: 0.95,
    sensitivity: HIGH,
    test({ element, rawValue }) {
      const metadata = metadataText(element);
      const evidence: string[] = [];
      if (hasAny(metadata, ["aadhaar", "aadhar", "uidai"])) evidence.push("metadata");
      if (rawValue && isAadhaarLikeValue(rawValue)) {
        evidence.push("input-value-pattern");
      }
      return evidence;
    }
  },
  {
    type: "PAN",
    confidence: 0.95,
    sensitivity: HIGH,
    test({ element, rawValue }) {
      const metadata = metadataText(element);
      const evidence: string[] = [];
      if (hasAny(metadata, ["pan card", "permanent account number", "income tax"]) || hasWholeWord(metadata, "pan")) {
        evidence.push("metadata");
      }
      if (rawValue && PII_PATTERNS.PAN.test(rawValue)) evidence.push("input-value-pattern");
      return evidence;
    }
  },
  {
    type: "UPI",
    confidence: 0.94,
    sensitivity: HIGH,
    test({ element, rawValue }) {
      const metadata = metadataText(element);
      const evidence: string[] = [];
      if (hasAny(metadata, ["upi", "vpa", "virtual payment address"])) evidence.push("metadata");
      if (rawValue && PII_PATTERNS.UPI.test(rawValue)) evidence.push("input-value-pattern");
      return evidence;
    }
  }
];

function collectInputs(doc: Document): DetectorInput[] {
  const elements = inspectDocument(doc);
  const sourceElements = Array.from(
    doc.querySelectorAll<Element>(
      [
        "a[href]",
        "button",
        "input",
        "select",
        "textarea",
        "label",
        "[role]",
        "[aria-label]",
        "[tabindex]",
        "summary",
        "details",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "main",
        "nav",
        "section",
        "article",
        "form"
      ].join(",")
    )
  );
  const win = (doc.defaultView ?? window) as Window & typeof globalThis;

  return elements.map((element, index) => ({
    element,
    rawValue: sourceElements[index] ? readRawValue(sourceElements[index], win) : null
  }));
}

export function detectPii(elements: NormalizedElement[]): PiiDetection[] {
  return elements.flatMap((element) => {
    const input: DetectorInput = { element, rawValue: null };

    return rules
      .map((rule) => ({ rule, evidence: rule.test(input) }))
      .filter(({ evidence }) => evidence.length > 0)
      .map(({ rule, evidence }) => buildDetection(rule, input, evidence));
  });
}

export function detectPiiInDocument(doc: Document = document): PiiDetection[] {
  return collectInputs(doc).flatMap((input) =>
    rules
      .map((rule) => ({ rule, evidence: rule.test(input) }))
      .filter(({ evidence }) => evidence.length > 0)
      .map(({ rule, evidence }) => buildDetection(rule, input, evidence))
  );
}
