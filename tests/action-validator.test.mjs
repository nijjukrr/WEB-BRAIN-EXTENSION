import test from "node:test";
import assert from "node:assert/strict";
import { createElementSnapshotHash, validateLocalAction } from "../dist/action-validator.js";

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

function sanitizedElement(overrides = {}) {
  return {
    id: "element_1",
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
    text: "Continue",
    bbox: box(),
    visible: true,
    enabled: true,
    redacted: false,
    redactionTypes: [],
    ...overrides
  };
}

function allowed(element, overrides = {}) {
  return {
    elementId: element.id,
    actions: ["click"],
    snapshotHash: createElementSnapshotHash(element),
    ...overrides
  };
}

test("allows a safe action when target exists, is visible, interactive, and unchanged", () => {
  const target = sanitizedElement();
  const decision = validateLocalAction({
    action: { action: "click", target: target.id },
    elements: [target],
    allowedInteractions: [allowed(target)]
  });

  assert.equal(decision.status, "execute");
});

test("rejects when target does not exist", () => {
  const target = sanitizedElement();
  const decision = validateLocalAction({
    action: { action: "click", target: "missing" },
    elements: [target],
    allowedInteractions: [allowed(target)]
  });

  assert.equal(decision.status, "reject");
  assert.equal(decision.reasons.includes("Target does not exist."), true);
});

test("rejects hidden and disabled targets", () => {
  const hidden = sanitizedElement({ visible: false });
  const disabled = sanitizedElement({ id: "element_2", enabled: false });

  const hiddenDecision = validateLocalAction({
    action: { action: "click", target: hidden.id },
    elements: [hidden],
    allowedInteractions: [allowed(hidden)]
  });
  const disabledDecision = validateLocalAction({
    action: { action: "click", target: disabled.id },
    elements: [disabled],
    allowedInteractions: [allowed(disabled)]
  });

  assert.equal(hiddenDecision.status, "reject");
  assert.equal(disabledDecision.status, "reject");
});

test("rejects disallowed action types for the target", () => {
  const target = sanitizedElement();
  const decision = validateLocalAction({
    action: { action: "focus", target: target.id },
    elements: [target],
    allowedInteractions: [allowed(target, { actions: ["click"] })]
  });

  assert.equal(decision.status, "reject");
  assert.equal(decision.reasons.includes("Action type is not allowed for this target."), true);
});

test("rejects target that changed after sanitization", () => {
  const original = sanitizedElement();
  const changed = sanitizedElement({ text: "Delete account" });
  const decision = validateLocalAction({
    action: { action: "click", target: changed.id },
    elements: [changed],
    allowedInteractions: [allowed(original)]
  });

  assert.equal(decision.status, "reject");
  assert.equal(decision.reasons.includes("Target changed unexpectedly since sanitization."), true);
});

test("blocks privacy-violating actions by default", () => {
  const password = sanitizedElement({
    tag: "input",
    type: "password",
    role: "textbox",
    text: null,
    placeholder: "<PASSWORD_1>",
    redacted: true,
    redactionTypes: ["PASSWORD"]
  });

  const decision = validateLocalAction({
    action: { action: "type_safe_text", target: password.id, text: "safe text" },
    elements: [password],
    allowedInteractions: [allowed(password, { actions: ["type_safe_text"], safeText: "safe text" })]
  });

  assert.equal(decision.status, "reject");
  assert.equal(decision.reasons.some((reason) => reason.includes("high-sensitivity")), true);
});

test("requires confirmation for dangerous payment, purchase, delete, transfer, and sensitive-submit actions", () => {
  const dangerousLabels = ["Pay now", "Purchase", "Transfer funds", "Delete account", "Submit application"];

  for (const label of dangerousLabels) {
    const target = sanitizedElement({ text: label });
    const decision = validateLocalAction({
      action: { action: "click", target: target.id },
      elements: [target],
      allowedInteractions: [allowed(target)]
    });

    assert.equal(decision.status, "requires_confirmation", `${label} should require confirmation`);
  }
});

test("executes dangerous action only after explicit user confirmation", () => {
  const target = sanitizedElement({ text: "Delete account" });
  const decision = validateLocalAction({
    action: { action: "click", target: target.id },
    elements: [target],
    allowedInteractions: [allowed(target)],
    userConfirmedDangerousAction: true
  });

  assert.equal(decision.status, "execute");
});

test("allows type_safe_text only when text matches local permission", () => {
  const target = sanitizedElement({
    tag: "input",
    role: "textbox",
    text: null,
    label: "Search",
    id: "element_3"
  });

  const ok = validateLocalAction({
    action: { action: "type_safe_text", target: target.id, text: "privacy agent" },
    elements: [target],
    allowedInteractions: [allowed(target, { actions: ["type_safe_text"], safeText: "privacy agent" })]
  });
  const bad = validateLocalAction({
    action: { action: "type_safe_text", target: target.id, text: "different" },
    elements: [target],
    allowedInteractions: [allowed(target, { actions: ["type_safe_text"], safeText: "privacy agent" })]
  });

  assert.equal(ok.status, "execute");
  assert.equal(bad.status, "reject");
});
