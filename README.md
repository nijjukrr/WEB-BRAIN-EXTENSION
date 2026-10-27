# Privacy Vision Agent Extension

A privacy-preserving browser agent foundation built as a Chrome Manifest V3 extension with a local perception and redaction pipeline, paired with a local backend agent step planner.

---

## Architecture Overview

1. **Client Extension (`dist/`)**:
   - **DOM Perception (`src/dom-perception.ts`)**: Identifies interactive elements, roles, bounds, and accessible labels.
   - **Local PII Detector (`src/pii-detector.ts`)**: Identifies emails, phone numbers, credit cards, Aadhaar, PAN, UPI IDs, passwords, and sensitive fields locally.
   - **Local OCR & Vision (`src/local-ocr.ts`, `src/local-vision.ts`)**: Visual detection and local OCR bounding box extraction.
   - **Redaction Engine (`src/redaction-engine.ts`)**: Irreversibly masks sensitive screen regions with semantic placeholders before transmission.
   - **Privacy Boundary & Network Guard (`src/privacy-boundary.ts`)**: Enforces fail-closed rules preventing raw PII, screenshots, or unredacted DOM elements from leaving the machine.
   - **Action Validator (`src/action-validator.ts`)**: Verifies model-proposed actions before executing them in the browser.

2. **Backend Agent Planner (`dist-backend/`)**:
   - **Server (`src/backend/server.ts`)**: HTTP service running on port 8787 exposing `POST /agent/step`.
   - **Schema Validation (`src/backend/schemas.ts`)**: Verifies payloads contain zero raw PII and conform to strict schema boundaries.
   - **Planner (`src/backend/planner.ts`, `src/backend/agent-step.ts`)**: Generates safe browser actions based solely on sanitized inputs.

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Build the Project
Compiles TypeScript, bundles both client (`dist/`) and backend (`dist-backend/`) with esbuild, and copies static extension files:
```bash
npm run build
```

### 3. Run the Test Suite
Runs all 49 automated test cases covering action validation, backend planning, DOM perception, OCR, PII detection, redaction, and transmission policy:
```bash
npm test
```

### 4. Start the Backend API Server
```bash
npm run start:backend
```
The server will listen at `http://localhost:8787/agent/step`.

---

## Loading the Extension in Chrome / Chromium Browsers

1. Run `npm run build` to generate the `dist/` directory.
2. Open Chrome (or Edge/Brave) and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** in the top-left corner.
5. Select the `dist` directory inside this repository (`c:\Users\nijju\OneDrive\Desktop\brozzer\dist`).
6. Click the extension icon in your browser toolbar to open the popup and interact with the Privacy Vision Agent.
