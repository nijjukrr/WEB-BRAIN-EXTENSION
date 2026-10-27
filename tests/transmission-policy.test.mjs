import test from "node:test";
import assert from "node:assert/strict";
import { buildAdaptiveTransmissionPayload, decideContextRepresentation } from "../dist/transmission-policy.js";
import { verifyPrivacyBoundary } from "../dist/privacy-boundary.js";
import { validateAgentStepRequest } from "../dist-backend/schemas.js";

function box(x = 10, y = 20, width = 120, height = 32) {
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

function sanitizedElement(id, overrides = {}) {
  return {
    id,
    tag: "button",
    domId: id,
    classes: [],
    type: null,
    name: null,
    placeholder: null,
    autocomplete: null,
    ariaLabel: null,
    label: null,
    role: "button",
    text: "Submit",
    bbox: box(),
    visible: true,
    enabled: true,
    redacted: false,
    redactionTypes: [],
    ...overrides
  };
}

function redactionOutput(overrides = {}) {
  return {
    sanitizedScreenshot: "data:image/svg+xml,%3Csvg%3E%3Ctext%3ECheckout%3C%2Ftext%3E%3C%2Fsvg%3E",
    sanitizedElements: [
      sanitizedElement("element_1", {
        tag: "input",
        role: "textbox",
        label: "Email",
        text: null,
        placeholder: "<EMAIL_1>",
        redacted: true,
        redactionTypes: ["EMAIL"]
      }),
      sanitizedElement("element_2")
    ],
    redactions: [
      {
        id: "redaction_1",
        type: "EMAIL",
        elementId: "element_1",
        bbox: box(),
        placeholder: "<EMAIL_1>",
        confidence: 0.98,
        sensitivity: "HIGH"
      }
    ],
    ...overrides
  };
}

test("chooses DOM-only for simple structured tasks", () => {
  const output = redactionOutput();
  const decision = decideContextRepresentation({
    userTask: "Click the submit button.",
    sanitizedScreenshot: output.sanitizedScreenshot,
    sanitizedElements: output.sanitizedElements,
    detections: []
  });

  assert.equal(decision.representation, "dom_only");
  assert.equal(decision.reasonCodes.includes("structured-context-sufficient"), true);
});

test("chooses screenshot plus element map for visually dependent tasks", () => {
  const output = redactionOutput();
  const decision = decideContextRepresentation({
    userTask: "Click the icon next to the preview image.",
    sanitizedScreenshot: output.sanitizedScreenshot,
    sanitizedElements: output.sanitizedElements,
    detections: []
  });

  assert.equal(decision.representation, "screenshot_with_element_map");
});

test("chooses focused visual context for complex visual tasks", () => {
  const output = redactionOutput({
    sanitizedElements: [
      sanitizedElement("element_1", { tag: "h1", role: "heading", text: "PDF preview" }),
      sanitizedElement("element_2", { tag: "vision-region", role: "image", text: null }),
      ...Array.from({ length: 60 }, (_, index) => sanitizedElement(`extra_${index}`, { text: `Button ${index}` }))
    ]
  });
  const decision = decideContextRepresentation({
    userTask: "Review the scanned PDF preview and find the submit area.",
    sanitizedScreenshot: output.sanitizedScreenshot,
    sanitizedElements: output.sanitizedElements,
    detections: [
      {
        type: "AADHAAR",
        elementId: "element_2",
        bbox: box(),
        confidence: 0.86,
        sensitivity: "HIGH",
        evidence: ["local-vision-aadhaar"]
      }
    ]
  });

  assert.equal(decision.representation, "focused_visual_context");
  assert.equal(decision.reasonCodes.includes("complex-visual-context-required"), true);
});

test("builds DOM-only payload without screenshot and logs metadata only", () => {
  const output = redactionOutput();
  const { payload, metadata } = buildAdaptiveTransmissionPayload({
    userTask: "Click the submit button.",
    redactionOutput: output,
    detections: [],
    allowedInteractions: [{ elementId: "element_2", actions: ["click"] }]
  });

  assert.equal(payload.contextRepresentation, "dom_only");
  assert.equal(payload.sanitizedScreenshot, null);
  assert.equal(metadata.includesScreenshot, false);
  assert.equal(metadata.capturedElementCount, 2);
  assert.equal(metadata.transmittedElementCount, 2);
  assert.equal(metadata.redactionCount, 1);
  assert.equal(JSON.stringify(metadata).includes("Email"), false);
  assert.equal(JSON.stringify(metadata).includes("<EMAIL_1>"), false);
});

test("adaptive payload remains compatible with privacy boundary verification", () => {
  const output = redactionOutput();
  const { payload } = buildAdaptiveTransmissionPayload({
    userTask: "Click the submit button.",
    redactionOutput: output,
    detections: [
      {
        type: "EMAIL",
        elementId: "element_1",
        bbox: box(),
        confidence: 0.98,
        sensitivity: "HIGH",
        evidence: ["metadata"]
      }
    ],
    allowedInteractions: [{ elementId: "element_2", actions: ["click"] }]
  });

  const verified = verifyPrivacyBoundary({
    elements: output.sanitizedElements,
    detections: [
      {
        type: "EMAIL",
        elementId: "element_1",
        bbox: box(),
        confidence: 0.98,
        sensitivity: "HIGH",
        evidence: ["metadata"]
      }
    ],
    redactionOutput: output,
    adaptivePayload: payload,
    rawScreenshot: "data:image/png;base64,RAW_SECRET",
    rawDom: '<input value="alice@example.com">',
    rawPiiValues: ["alice@example.com"]
  });

  assert.equal(verified.ok, true);
  assert.equal(verified.payload?.sanitizedScreenshot, null);
  assert.equal(verified.report.rawPiiLeakageCount, 0);
});

test("backend accepts DOM-only adaptive requests without screenshot", () => {
  const output = redactionOutput();
  const { payload } = buildAdaptiveTransmissionPayload({
    userTask: "Click the submit button.",
    redactionOutput: output,
    detections: [],
    allowedInteractions: [{ elementId: "element_2", actions: ["click"] }]
  });

  const validated = validateAgentStepRequest({
    userTask: payload.userTask,
    contextRepresentation: payload.contextRepresentation,
    sanitizedScreenshot: payload.sanitizedScreenshot,
    sanitizedElementMap: payload.sanitizedElementMap,
    allowedInteractions: payload.allowedInteractions
  });

  assert.equal(validated.ok, true);
  if (validated.ok) {
    assert.equal(validated.value.contextRepresentation, "dom_only");
    assert.equal(validated.value.sanitizedScreenshot, null);
  }
});

test("backend rejects DOM-only requests that still include a screenshot", () => {
  const validated = validateAgentStepRequest({
    userTask: "Click submit.",
    contextRepresentation: "dom_only",
    sanitizedScreenshot: "data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E",
    sanitizedElementMap: [sanitizedElement("element_2")],
    allowedInteractions: [{ elementId: "element_2", actions: ["click"] }]
  });

  assert.equal(validated.ok, false);
});
