import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createColorRegionVisionProvider } from "../dist/local-vision.js";
import { runUnifiedPrivacyPipeline } from "../dist/privacy-pipeline.js";
import { aggregateDetections } from "../dist/detection-aggregator.js";

const dom = new JSDOM("<!doctype html>");
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.atob = globalThis.atob ?? ((value) => Buffer.from(value, "base64").toString("binary"));
globalThis.btoa = globalThis.btoa ?? ((value) => Buffer.from(value, "binary").toString("base64"));

function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function decodeSvgDataUrl(dataUrl) {
  return decodeURIComponent(dataUrl.slice(dataUrl.indexOf(",") + 1));
}

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

test("lightweight local vision detects specialized visual PII bounding boxes", async () => {
  const screenshot = svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="360" height="180">
      <text x="20" y="30">Invoice preview</text>
      <rect x="40" y="60" width="140" height="40" fill="#ff00ff" />
      <text x="48" y="84">Visual card</text>
      <text x="20" y="150">Download</text>
    </svg>
  `);
  const provider = createColorRegionVisionProvider([
    {
      type: "CARD",
      sensitivity: "HIGH",
      confidence: 0.87,
      color: [255, 0, 255],
      tolerance: 0
    }
  ]);

  const result = await provider.detect(screenshot);

  assert.equal(result.metrics.backend, "cpu");
  assert.equal(result.detections.length, 1);
  assert.equal(result.detections[0].type, "CARD");
  assert.deepEqual(result.detections[0].bbox, box(40, 60, 140, 40));
  assert.equal(result.elements[0].id, "vision_element_1");
  assert.equal(result.elements[0].text, null);
});

test("unified privacy pipeline aggregates vision detections and redacts screenshot", async () => {
  const screenshot = svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="360" height="180">
      <text x="20" y="30">PDF preview</text>
      <rect x="40" y="60" width="160" height="40" fill="#00ff00" />
      <text x="48" y="84">Scanned ID</text>
      <text x="20" y="150">Close</text>
    </svg>
  `);
  const provider = createColorRegionVisionProvider([
    {
      type: "AADHAAR",
      sensitivity: "HIGH",
      confidence: 0.86,
      color: [0, 255, 0],
      tolerance: 0
    }
  ]);

  const result = await runUnifiedPrivacyPipeline({
    screenshot,
    visionProvider: provider
  });
  const sanitizedSvg = decodeSvgDataUrl(result.redactionOutput.sanitizedScreenshot);

  assert.equal(result.detections.length, 1);
  assert.equal(result.detections[0].source, "vision");
  assert.equal(result.redactionOutput.redactions[0].placeholder, "<AADHAAR_1>");
  assert.equal(sanitizedSvg.includes("PDF preview"), true);
  assert.equal(sanitizedSvg.includes("Close"), true);
  assert.equal(sanitizedSvg.includes("&lt;AADHAAR_1&gt;") || sanitizedSvg.includes("<AADHAAR_1>"), true);
});

test("aggregator deduplicates overlapping DOM, OCR, and vision detections", () => {
  const base = {
    type: "EMAIL",
    elementId: "element_1",
    bbox: box(10, 10, 120, 30),
    confidence: 0.8,
    sensitivity: "HIGH",
    evidence: ["test"]
  };

  const aggregated = aggregateDetections({
    dom: [{ ...base, confidence: 0.99 }],
    ocr: [{ ...base, elementId: "ocr_element_1", confidence: 0.9 }],
    vision: [{ ...base, elementId: "vision_element_1", confidence: 0.7 }]
  });

  assert.equal(aggregated.length, 1);
  assert.equal(aggregated[0].source, "dom");
  assert.equal(aggregated[0].confidence, 0.99);
});
