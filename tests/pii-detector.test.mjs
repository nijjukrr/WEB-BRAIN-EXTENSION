import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { detectPiiInDocument } from "../dist/pii-detector.js";

function createFixture(html) {
  const dom = new JSDOM(html, {
    url: "https://example.test/profile",
    pretendToBeVisual: true
  });

  const { document } = dom.window;

  for (const element of document.querySelectorAll("*")) {
    element.getBoundingClientRect = () => ({
      x: 10,
      y: 20,
      width: 200,
      height: 32,
      top: 20,
      left: 10,
      right: 210,
      bottom: 52,
      toJSON() {
        return this;
      }
    });
  }

  return document;
}

function typesFor(html) {
  return detectPiiInDocument(createFixture(html)).map((detection) => detection.type);
}

function detectionsFor(html) {
  return detectPiiInDocument(createFixture(html));
}

test("detects required PII categories from DOM metadata and input values", () => {
  const detections = detectionsFor(`
    <label for="password">Password</label>
    <input id="password" type="password" autocomplete="current-password" value="super-secret" />

    <label for="email">Email</label>
    <input id="email" type="email" autocomplete="email" value="person@example.com" />

    <label for="phone">Mobile number</label>
    <input id="phone" type="tel" value="+91 9876543210" />

    <label for="card">Credit card number</label>
    <input id="card" autocomplete="cc-number" value="4111 1111 1111 1111" />

    <label for="cvv">CVV</label>
    <input id="cvv" autocomplete="cc-csc" value="123" />

    <label for="otp">OTP verification code</label>
    <input id="otp" value="482913" />

    <label for="name">Full name</label>
    <input id="name" autocomplete="name" value="Asha Sharma" />

    <label for="address">Shipping address</label>
    <textarea id="address" autocomplete="street-address">MG Road</textarea>

    <label for="api">API key</label>
    <input id="api" value="sk-test_1234567890abcdefghi" />

    <label for="aadhaar">Aadhaar number</label>
    <input id="aadhaar" value="1234 5678 9012" />

    <label for="pan">PAN card</label>
    <input id="pan" value="ABCDE1234F" />

    <label for="upi">UPI ID</label>
    <input id="upi" value="rahul.kumar@oksbi" />
  `);

  const types = detections.map((detection) => detection.type);

  for (const expected of ["PASSWORD", "EMAIL", "PHONE", "CARD", "CVV", "OTP", "NAME", "ADDRESS", "API_KEY", "AADHAAR", "PAN", "UPI"]) {
    assert.equal(types.includes(expected), true, `${expected} should be detected`);
  }

  for (const detection of detections) {
    assert.equal(typeof detection.elementId, "string");
    assert.equal(detection.elementId.startsWith("element_"), true);
    assert.equal(typeof detection.confidence, "number");
    assert.equal(["MEDIUM", "HIGH"].includes(detection.sensitivity), true);
    assert.deepEqual(Object.keys(detection.bbox), ["x", "y", "width", "height", "top", "right", "bottom", "left"]);
    assert.equal("value" in detection, false);
    assert.equal("rawValue" in detection, false);
  }
});

test("detects regex-only sensitive values without returning raw values", () => {
  const detections = detectionsFor(`
    <input id="text-email" value="ops@example.com" />
    <input id="text-pan" value="ABCDE1234F" />
    <input id="text-upi" value="merchant.store@okaxis" />
    <input id="text-api" value="github_pat_1234567890abcdefghijklmnop" />
  `);

  const types = detections.map((detection) => detection.type);

  assert.equal(types.includes("EMAIL"), true);
  assert.equal(types.includes("PAN"), true);
  assert.equal(types.includes("UPI"), true);
  assert.equal(types.includes("API_KEY"), true);
  assert.equal(JSON.stringify(detections).includes("ops@example.com"), false);
  assert.equal(JSON.stringify(detections).includes("ABCDE1234F"), false);
});

test("does not flag common false positives as card, Aadhaar, PAN, or UPI", () => {
  const types = typesFor(`
    <label for="sku">Product ID</label>
    <input id="sku" value="1234567890123" />

    <label for="order">Order reference</label>
    <input id="order" value="0000 0000 0000 0000" />

    <label for="company">Company panel</label>
    <input id="company" name="company_panel" value="ACME-SALES-2026" />

    <label for="social">Social handle</label>
    <input id="social" value="@rahul" />
  `);

  assert.equal(types.includes("CARD"), false);
  assert.equal(types.includes("AADHAAR"), false);
  assert.equal(types.includes("PAN"), false);
  assert.equal(types.includes("UPI"), false);
});

test("keeps name and address detection conservative", () => {
  const types = typesFor(`
    <button>Save name preference</button>
    <a href="/addresses">Address book help</a>
    <input id="nickname" name="nickname" value="Ace" />
    <input id="city-search" placeholder="Search city guides" value="Delhi travel" />
  `);

  assert.equal(types.includes("NAME"), false);
  assert.equal(types.includes("ADDRESS"), false);
});
