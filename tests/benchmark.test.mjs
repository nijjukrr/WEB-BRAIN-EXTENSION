import test from "node:test";
import assert from "node:assert/strict";
import { benchmarkVisionBackends, scoreDetectionAccuracy } from "../dist/benchmark.js";

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

function provider(backend, detections) {
  return {
    backend,
    async detect() {
      return {
        elements: [],
        detections,
        metrics: {
          backend,
          preprocessingMs: 1,
          inferenceMs: backend === "webgpu" ? 2 : 5,
          postprocessingMs: 1,
          totalMs: backend === "webgpu" ? 4 : 7,
          memoryBytes: 123456
        }
      };
    }
  };
}

test("scores detection accuracy with IoU matching", () => {
  const accuracy = scoreDetectionAccuracy(
    [
      {
        type: "CARD",
        elementId: "vision_element_1",
        bbox: box(10, 10, 100, 40),
        confidence: 0.9,
        sensitivity: "HIGH",
        evidence: ["vision"]
      },
      {
        type: "EMAIL",
        elementId: "vision_element_2",
        bbox: box(200, 10, 80, 20),
        confidence: 0.7,
        sensitivity: "HIGH",
        evidence: ["vision"]
      }
    ],
    [{ type: "CARD", bbox: box(12, 12, 98, 38) }]
  );

  assert.equal(accuracy.truePositives, 1);
  assert.equal(accuracy.falsePositives, 1);
  assert.equal(accuracy.falseNegatives, 0);
  assert.equal(accuracy.precision, 0.5);
  assert.equal(accuracy.recall, 1);
});

test("benchmarks WebGPU and WASM provider latency, memory, and accuracy", async () => {
  const detection = {
    type: "CARD",
    elementId: "vision_element_1",
    bbox: box(10, 10, 100, 40),
    confidence: 0.9,
    sensitivity: "HIGH",
    evidence: ["vision"]
  };

  const results = await benchmarkVisionBackends({
    screenshot: "data:image/png;base64,test",
    providers: [provider("webgpu", [detection]), provider("wasm", [detection])],
    groundTruth: [{ type: "CARD", bbox: box(10, 10, 100, 40) }]
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].backend, "webgpu");
  assert.equal(results[1].backend, "wasm");
  assert.equal(results[0].inferenceMs, 2);
  assert.equal(results[1].inferenceMs, 5);
  assert.equal(results[0].memoryBytes, 123456);
  assert.equal(results[0].detectionAccuracy.precision, 1);
  assert.equal(results[0].detectionAccuracy.recall, 1);
});
