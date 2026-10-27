import test from "node:test";
import assert from "node:assert/strict";
import {
  installFailClosedNetworkGuard,
  sendSanitizedThroughBoundary,
  verifyPrivacyBoundary
} from "../dist/privacy-boundary.js";

function box(x, y, width, height) {
  return {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x
  };
}

function element(id, overrides = {}) {
  return {
    id,
    tag: "input",
    domId: id,
    classes: [],
    type: "email",
    name: "email",
    placeholder: null,
    autocomplete: "email",
    ariaLabel: "Email",
    label: "Email",
    role: "textbox",
    text: null,
    bbox: box(10, 20, 200, 30),
    visible: true,
    enabled: true,
    ...overrides
  };
}

function detection(elementId, overrides = {}) {
  return {
    type: "EMAIL",
    elementId,
    bbox: box(10, 20, 200, 30),
    confidence: 0.98,
    sensitivity: "HIGH",
    evidence: ["metadata"],
    ...overrides
  };
}

function sanitizedElement(id, overrides = {}) {
  return {
    ...element(id),
    redacted: true,
    placeholder: "<EMAIL_1>",
    redactionTypes: ["EMAIL"],
    ...overrides
  };
}

function safeInput() {
  const elements = [
    element("element_1"),
    element("element_2", {
      tag: "button",
      domId: "submit",
      type: null,
      name: null,
      autocomplete: null,
      ariaLabel: null,
      label: null,
      role: "button",
      text: "Submit"
    })
  ];

  return {
    elements,
    detections: [detection("element_1")],
    redactionOutput: {
      sanitizedScreenshot: "data:image/svg+xml,%3Csvg%3E%3Ctext%3E%3CEMAIL_1%3E%3C%2Ftext%3E%3C%2Fsvg%3E",
      sanitizedElements: [
        sanitizedElement("element_1"),
        {
          ...elements[1],
          redacted: false,
          placeholder: null,
          redactionTypes: []
        }
      ],
      redactions: [
        {
          id: "redaction_1",
          type: "EMAIL",
          elementId: "element_1",
          bbox: box(10, 20, 200, 30),
          placeholder: "<EMAIL_1>",
          confidence: 0.98,
          sensitivity: "HIGH"
        }
      ]
    },
    rawScreenshot: "data:image/png;base64,RAW_SCREENSHOT_SECRET",
    rawDom: '<input value="alice@example.com">',
    rawPiiValues: ["alice@example.com", "4111111111111111", "123456"]
  };
}

test("allows only sanitized context through audited transport", async () => {
  const observedRequests = [];
  const input = safeInput();

  const result = await sendSanitizedThroughBoundary(
    input,
    { url: "https://example.test/local-boundary-check" },
    async (request) => {
      observedRequests.push(request);
      return { ok: true, status: 200 };
    }
  );

  assert.equal(result.ok, true);
  assert.equal(observedRequests.length, 1);
  assert.equal(result.report.capturedElements, 2);
  assert.equal(result.report.sensitiveElements, 1);
  assert.equal(result.report.redacted, 1);
  assert.equal(result.report.blocked, 0);
  assert.equal(result.report.networkRequests.length, 1);
  assert.equal(result.report.rawPiiLeakageCount, 0);
  assert.equal(result.report.sanitizedPayloadSize > 0, true);

  const sentBody = observedRequests[0].body;
  assert.equal(sentBody.includes("alice@example.com"), false);
  assert.equal(sentBody.includes("4111111111111111"), false);
  assert.equal(sentBody.includes("RAW_SCREENSHOT_SECRET"), false);
  assert.equal(sentBody.includes("<EMAIL_1>"), true);
  assert.equal(sentBody.includes("Submit"), true);
});

test("blocks if a raw PII value appears in sanitized output", () => {
  const input = safeInput();
  input.redactionOutput.sanitizedElements[0].text = "alice@example.com";

  const result = verifyPrivacyBoundary(input);

  assert.equal(result.ok, false);
  assert.equal(result.payload, null);
  assert.equal(result.violations.includes("raw-pii-leakage"), true);
  assert.equal(result.report.rawPiiLeakageCount, 1);
});

test("blocks raw screenshot leakage", () => {
  const input = safeInput();
  input.redactionOutput.sanitizedScreenshot = input.rawScreenshot;

  const result = verifyPrivacyBoundary(input);

  assert.equal(result.ok, false);
  assert.equal(result.violations.includes("raw-pii-leakage"), true);
});

test("blocks raw DOM leakage", () => {
  const input = safeInput();
  input.redactionOutput.sanitizedElements[0].placeholder = input.rawDom;

  const result = verifyPrivacyBoundary(input);

  assert.equal(result.ok, false);
  assert.equal(result.violations.includes("raw-pii-leakage"), true);
});

test("fails closed when a sensitive detection has no redaction", async () => {
  const input = safeInput();
  input.redactionOutput.redactions = [];
  input.redactionOutput.sanitizedElements[0].redacted = false;
  input.redactionOutput.sanitizedElements[0].placeholder = null;
  const observedRequests = [];

  const result = await sendSanitizedThroughBoundary(
    input,
    { url: "https://example.test/blocked" },
    async (request) => {
      observedRequests.push(request);
      return { ok: true, status: 200 };
    }
  );

  assert.equal(result.ok, false);
  assert.equal(observedRequests.length, 0);
  assert.equal(result.report.blocked, 1);
  assert.equal(result.report.networkRequests[0].blocked, true);
  assert.equal(result.violations.includes("missing-redactions"), true);
  assert.equal(result.violations.includes("sensitive-element-not-redacted"), true);
});

test("global network guard blocks unaudited requests", async () => {
  const originalFetch = globalThis.fetch;
  const originalNavigator = globalThis.navigator;

  Object.defineProperty(globalThis, "__privacyBoundaryGuardInstalled", {
    value: false,
    configurable: true,
    writable: true
  });

  globalThis.fetch = async () => new Response("unsafe");
  Object.defineProperty(globalThis, "navigator", {
    value: {
      sendBeacon() {
        return true;
      }
    },
    configurable: true
  });

  installFailClosedNetworkGuard();

  await assert.rejects(() => globalThis.fetch("https://example.test/raw"), /Blocked by privacy boundary/);
  assert.equal(globalThis.navigator.sendBeacon("https://example.test/raw"), false);

  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "navigator", {
    value: originalNavigator,
    configurable: true
  });
});
