import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { redactLocalContext } from "../dist/redaction-engine.js";

const dom = new JSDOM("<!doctype html>");
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.atob = globalThis.atob ?? ((value) => Buffer.from(value, "base64").toString("binary"));
globalThis.btoa = globalThis.btoa ?? ((value) => Buffer.from(value, "binary").toString("base64"));

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

function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function decodeSvgDataUrl(dataUrl) {
  return decodeURIComponent(dataUrl.slice(dataUrl.indexOf(",") + 1));
}

test("removes sensitive screenshot text and leaves semantic placeholder", async () => {
  const emailBox = box(92, 30, 190, 24);
  const screenshot = svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="400" height="140">
      <text x="20" y="46">Email</text>
      <text x="100" y="46">alice@example.com</text>
      <text x="20" y="96">Submit</text>
    </svg>
  `);

  const output = await redactLocalContext({
    screenshot,
    elements: [
      {
        id: "element_1",
        tag: "label",
        domId: null,
        classes: [],
        type: null,
        name: null,
        placeholder: null,
        autocomplete: null,
        ariaLabel: null,
        label: null,
        role: "generic",
        text: "Email",
        bbox: box(18, 30, 60, 24),
        visible: true,
        enabled: true
      },
      {
        id: "element_2",
        tag: "input",
        domId: "email",
        classes: ["field"],
        type: "email",
        name: "email",
        placeholder: "alice@example.com",
        autocomplete: "email",
        ariaLabel: "Email",
        label: "Email",
        role: "textbox",
        text: null,
        bbox: emailBox,
        visible: true,
        enabled: true
      },
      {
        id: "element_3",
        tag: "button",
        domId: "submit",
        classes: [],
        type: null,
        name: null,
        placeholder: null,
        autocomplete: null,
        ariaLabel: null,
        label: null,
        role: "button",
        text: "Submit",
        bbox: box(18, 80, 120, 28),
        visible: true,
        enabled: true
      }
    ],
    detections: [
      {
        type: "EMAIL",
        elementId: "element_2",
        bbox: emailBox,
        confidence: 0.98,
        sensitivity: "HIGH",
        evidence: ["metadata"]
      }
    ]
  });

  const sanitizedSvg = decodeSvgDataUrl(output.sanitizedScreenshot);
  const sanitizedJson = JSON.stringify(output);

  assert.equal(sanitizedSvg.includes("alice@example.com"), false);
  assert.equal(sanitizedSvg.includes("&lt;EMAIL_1&gt;") || sanitizedSvg.includes("<EMAIL_1>"), true);
  assert.equal(sanitizedSvg.includes("Email"), true);
  assert.equal(sanitizedSvg.includes("Submit"), true);
  assert.equal(sanitizedJson.includes("alice@example.com"), false);
});

test("preserves bounding boxes and redaction metadata", async () => {
  const phoneBox = box(40, 50, 160, 30);
  const screenshot = svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="120">
      <text x="42" y="68">9876543210</text>
    </svg>
  `);

  const output = await redactLocalContext({
    screenshot,
    elements: [
      {
        id: "element_7",
        tag: "input",
        domId: "phone",
        classes: [],
        type: "tel",
        name: "phone",
        placeholder: null,
        autocomplete: "tel",
        ariaLabel: "Phone",
        label: "Phone",
        role: "textbox",
        text: null,
        bbox: phoneBox,
        visible: true,
        enabled: true
      }
    ],
    detections: [
      {
        type: "PHONE",
        elementId: "element_7",
        bbox: phoneBox,
        confidence: 0.96,
        sensitivity: "HIGH",
        evidence: ["input-type"]
      }
    ]
  });

  assert.deepEqual(output.redactions[0].bbox, phoneBox);
  assert.deepEqual(output.sanitizedElements[0].bbox, phoneBox);
  assert.equal(output.redactions[0].placeholder, "<PHONE_1>");
  assert.equal(output.sanitizedElements[0].placeholder, "<PHONE_1>");
  assert.equal(output.sanitizedElements[0].label, "Phone");
});

test("assigns stable semantic placeholders by type", async () => {
  const output = await redactLocalContext({
    screenshot: svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>'),
    elements: [
      {
        id: "element_1",
        tag: "input",
        domId: "name",
        classes: [],
        type: "text",
        name: "full_name",
        placeholder: "Full name",
        autocomplete: "name",
        ariaLabel: "Full name",
        label: "Full name",
        role: "textbox",
        text: null,
        bbox: box(0, 0, 100, 20),
        visible: true,
        enabled: true
      },
      {
        id: "element_2",
        tag: "input",
        domId: "otp",
        classes: [],
        type: "text",
        name: "otp",
        placeholder: "OTP",
        autocomplete: "one-time-code",
        ariaLabel: "OTP",
        label: "OTP",
        role: "textbox",
        text: null,
        bbox: box(0, 30, 100, 20),
        visible: true,
        enabled: true
      }
    ],
    detections: [
      {
        type: "NAME",
        elementId: "element_1",
        bbox: box(0, 0, 100, 20),
        confidence: 0.88,
        sensitivity: "MEDIUM",
        evidence: ["metadata"]
      },
      {
        type: "OTP",
        elementId: "element_2",
        bbox: box(0, 30, 100, 20),
        confidence: 0.95,
        sensitivity: "HIGH",
        evidence: ["metadata"]
      }
    ]
  });

  assert.equal(output.redactions[0].placeholder, "<PERSON_1>");
  assert.equal(output.redactions[0].type, "PERSON");
  assert.equal(output.redactions[1].placeholder, "<OTP_1>");
});

test("keeps non-sensitive UI unredacted", async () => {
  const screenshot = svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="120">
      <text x="20" y="30">Checkout</text>
      <text x="20" y="90">Continue</text>
    </svg>
  `);

  const output = await redactLocalContext({
    screenshot,
    elements: [
      {
        id: "element_1",
        tag: "h1",
        domId: null,
        classes: [],
        type: null,
        name: null,
        placeholder: null,
        autocomplete: null,
        ariaLabel: null,
        label: null,
        role: "heading",
        text: "Checkout",
        bbox: box(18, 12, 120, 28),
        visible: true,
        enabled: true
      },
      {
        id: "element_2",
        tag: "button",
        domId: "continue",
        classes: [],
        type: null,
        name: null,
        placeholder: null,
        autocomplete: null,
        ariaLabel: null,
        label: null,
        role: "button",
        text: "Continue",
        bbox: box(18, 70, 120, 28),
        visible: true,
        enabled: true
      }
    ],
    detections: []
  });

  const sanitizedSvg = decodeSvgDataUrl(output.sanitizedScreenshot);

  assert.equal(sanitizedSvg.includes("Checkout"), true);
  assert.equal(sanitizedSvg.includes("Continue"), true);
  assert.equal(output.sanitizedElements.every((element) => element.redacted === false), true);
  assert.equal(output.redactions.length, 0);
});
