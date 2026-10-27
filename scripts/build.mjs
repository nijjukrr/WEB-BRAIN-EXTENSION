import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { copyStaticFiles } from "./copy-static.mjs";

const root = process.cwd();
const dist = resolve(root, "dist");
const backendDist = resolve(root, "dist-backend");

await mkdir(dist, { recursive: true });
await mkdir(backendDist, { recursive: true });

await build({
  entryPoints: {
    "action-validator": resolve(root, "src/action-validator.ts"),
    background: resolve(root, "src/background.ts"),
    benchmark: resolve(root, "src/benchmark.ts"),
    content: resolve(root, "src/content.ts"),
    "detection-aggregator": resolve(root, "src/detection-aggregator.ts"),
    "pii-detector": resolve(root, "src/pii-detector.ts"),
    "privacy-boundary": resolve(root, "src/privacy-boundary.ts"),
    "privacy-pipeline": resolve(root, "src/privacy-pipeline.ts"),
    "redaction-engine": resolve(root, "src/redaction-engine.ts"),
    "transmission-policy": resolve(root, "src/transmission-policy.ts"),
    popup: resolve(root, "src/popup.ts"),
    "dom-perception": resolve(root, "src/dom-perception.ts"),
    "local-ocr": resolve(root, "src/local-ocr.ts"),
    "local-vision": resolve(root, "src/local-vision.ts")
  },
  bundle: true,
  format: "esm",
  target: "es2022",
  outdir: dist,
  sourcemap: false,
  logLevel: "silent"
});

await build({
  entryPoints: {
    server: resolve(root, "src/backend/server.ts"),
    "agent-step": resolve(root, "src/backend/agent-step.ts"),
    planner: resolve(root, "src/backend/planner.ts"),
    schemas: resolve(root, "src/backend/schemas.ts")
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  outdir: backendDist,
  sourcemap: false,
  logLevel: "silent"
});

await copyStaticFiles();
