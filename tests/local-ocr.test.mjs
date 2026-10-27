import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { classifyOcrTokens, redactScreenshotWithLocalOcr } from "../dist/local-ocr.js";

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

function syntheticOcrProvider() {
  return {
    async recognize(image) {
      const svg = decodeSvgDataUrl(image);
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");

      return Array.from(doc.querySelectorAll("text")).map((text) => {
        const x = Number(text.getAttribute("x"));
        const y = Number(text.getAttribute("y"));
        const width = Number(text.getAttribute("data-width") ?? 180);
        const height = Number(text.getAttribute("data-height") ?? 22);

        return {
          text: text.textContent ?? "",
          bbox: box(x, y - height + 4, width, height),
          confidence: 0.99
        };
      });
    }
  };
}

test("classifies local OCR tokens without returning raw values", () => {
  const tokens = [
    { text: "student@example.com", bbox: box(10, 10, 180, 22), confidence: 0.99 },
    { text: "+91 9876543210", bbox: box(10, 40, 160, 22), confidence: 0.99 },
    { text: "4111 1111 1111 1111", bbox: box(10, 70, 210, 22), confidence: 0.99 },
    { text: "1234 5678 9012", bbox: box(10, 100, 170, 22), confidence: 0.99 }
  ];

  const result = classifyOcrTokens(tokens);
  const types = result.detections.map((detection) => detection.type);
  const serialized = JSON.stringify(result);

  assert.equal(types.includes("EMAIL"), true);
  assert.equal(types.includes("PHONE"), true);
  assert.equal(types.includes("CARD"), true);
  assert.equal(types.includes("AADHAAR"), true);
  assert.equal(serialized.includes("student@example.com"), false);
  assert.equal(serialized.includes("9876543210"), false);
  assert.equal(serialized.includes("4111 1111 1111 1111"), false);
  assert.equal(serialized.includes("1234 5678 9012"), false);
});

test("redacts synthetic image OCR email, phone, card, and ID-like number", async () => {
  const screenshot = svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="260">
      <text x="20" y="30">Scanned invoice</text>
      <text x="20" y="70" data-width="190">student@example.com</text>
      <text x="20" y="110" data-width="170">+91 9876543210</text>
      <text x="20" y="150" data-width="230">4111 1111 1111 1111</text>
      <text x="20" y="190" data-width="180">1234 5678 9012</text>
      <text x="20" y="230">Submit</text>
    </svg>
  `);

  const result = await redactScreenshotWithLocalOcr({
    screenshot,
    domElements: [],
    domDetections: [],
    ocrProvider: syntheticOcrProvider()
  });

  const sanitizedSvg = decodeSvgDataUrl(result.redactionOutput.sanitizedScreenshot);
  const serializedOutput = JSON.stringify(result);
  const ocrTypes = result.ocrDetections.map((detection) => detection.type);

  assert.equal(ocrTypes.includes("EMAIL"), true);
  assert.equal(ocrTypes.includes("PHONE"), true);
  assert.equal(ocrTypes.includes("CARD"), true);
  assert.equal(ocrTypes.includes("AADHAAR"), true);

  assert.equal(sanitizedSvg.includes("student@example.com"), false);
  assert.equal(sanitizedSvg.includes("9876543210"), false);
  assert.equal(sanitizedSvg.includes("4111 1111 1111 1111"), false);
  assert.equal(sanitizedSvg.includes("1234 5678 9012"), false);

  assert.equal(sanitizedSvg.includes("&lt;EMAIL_1&gt;") || sanitizedSvg.includes("<EMAIL_1>"), true);
  assert.equal(sanitizedSvg.includes("&lt;PHONE_1&gt;") || sanitizedSvg.includes("<PHONE_1>"), true);
  assert.equal(sanitizedSvg.includes("&lt;CARD_1&gt;") || sanitizedSvg.includes("<CARD_1>"), true);
  assert.equal(sanitizedSvg.includes("&lt;AADHAAR_1&gt;") || sanitizedSvg.includes("<AADHAAR_1>"), true);
  assert.equal(sanitizedSvg.includes("Scanned invoice"), true);
  assert.equal(sanitizedSvg.includes("Submit"), true);

  assert.equal(serializedOutput.includes("student@example.com"), false);
  assert.equal(serializedOutput.includes("9876543210"), false);
  assert.equal(serializedOutput.includes("4111 1111 1111 1111"), false);
  assert.equal(serializedOutput.includes("1234 5678 9012"), false);
});

test("preserves OCR bounding boxes through the redaction pipeline", async () => {
  const screenshot = svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="100">
      <text x="40" y="60" data-width="180" data-height="24">person@example.com</text>
    </svg>
  `);

  const result = await redactScreenshotWithLocalOcr({
    screenshot,
    domElements: [],
    domDetections: [],
    ocrProvider: syntheticOcrProvider()
  });

  assert.equal(result.redactionOutput.redactions.length, 1);
  assert.deepEqual(result.redactionOutput.redactions[0].bbox, box(40, 40, 180, 24));
  assert.equal(result.redactionOutput.sanitizedElements[0].bbox.left, 40);
  assert.equal(result.redactionOutput.sanitizedElements[0].placeholder, "<EMAIL_1>");
});
