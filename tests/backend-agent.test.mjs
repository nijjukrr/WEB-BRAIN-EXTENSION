import test from "node:test";
import assert from "node:assert/strict";
import { handleAgentStep } from "../dist-backend/agent-step.js";
import { validateAgentAction, validateAgentStepRequest } from "../dist-backend/schemas.js";

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

function element(id, overrides = {}) {
  return {
    id,
    tag: "button",
    role: "button",
    label: null,
    text: "Submit",
    placeholder: null,
    redacted: false,
    enabled: true,
    visible: true,
    bbox: box(),
    ...overrides
  };
}

function sanitizedRequest(overrides = {}) {
  return {
    userTask: "Click the submit button.",
    sanitizedScreenshot: "data:image/svg+xml,%3Csvg%3E%3Ctext%3ECheckout%3C%2Ftext%3E%3C%2Fsvg%3E",
    sanitizedElementMap: [
      element("element_1", {
        tag: "input",
        role: "textbox",
        label: "Email",
        text: null,
        placeholder: "<EMAIL_1>",
        redacted: true
      }),
      element("element_2", {
        text: "Submit"
      })
    ],
    allowedInteractions: [
      { elementId: "element_1", actions: ["focus"] },
      { elementId: "element_2", actions: ["click"] }
    ],
    ...overrides
  };
}

test("POST /agent/step handler returns a strict click action for sanitized context", async () => {
  const result = await handleAgentStep(sanitizedRequest());

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    action: "click",
    target: "element_2"
  });
});

test("request validation rejects raw PII in sanitized element map", () => {
  const result = validateAgentStepRequest(
    sanitizedRequest({
      sanitizedElementMap: [
        element("element_1", {
          tag: "input",
          role: "textbox",
          label: "Email",
          text: "alice@example.com",
          redacted: true
        })
      ],
      allowedInteractions: [{ elementId: "element_1", actions: ["focus"] }]
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes("raw PII")), true);
});

test("request validation rejects raw PII in screenshot payload", () => {
  const result = validateAgentStepRequest(
    sanitizedRequest({
      sanitizedScreenshot: "data:image/svg+xml,%3Csvg%3Ealice@example.com%3C%2Fsvg%3E"
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes("raw PII")), true);
});

test("model response validation rejects executable code fields", () => {
  const request = validateAgentStepRequest(sanitizedRequest());
  assert.equal(request.ok, true);
  if (!request.ok) return;

  const result = validateAgentAction(
    {
      action: "click",
      target: "element_2",
      code: "document.body.innerHTML = ''"
    },
    request.value
  );

  assert.equal(result.ok, false);
  assert.equal(result.errors.includes("Executable code fields are not allowed."), true);
});

test("model response validation rejects unsupported actions and unallowed targets", () => {
  const request = validateAgentStepRequest(sanitizedRequest());
  assert.equal(request.ok, true);
  if (!request.ok) return;

  const unsupported = validateAgentAction({ action: "run_javascript", target: "element_2" }, request.value);
  const wrongTarget = validateAgentAction({ action: "click", target: "element_1" }, request.value);

  assert.equal(unsupported.ok, false);
  assert.equal(wrongTarget.ok, false);
});

test("type_safe_text only allows locally supplied safe text", () => {
  const request = validateAgentStepRequest(
    sanitizedRequest({
      userTask: "Type safe text into the search box.",
      sanitizedElementMap: [
        element("element_3", {
          tag: "input",
          role: "textbox",
          label: "Search",
          text: null
        })
      ],
      allowedInteractions: [{ elementId: "element_3", actions: ["type_safe_text"], safeText: "privacy agent" }]
    })
  );
  assert.equal(request.ok, true);
  if (!request.ok) return;

  const allowed = validateAgentAction({ action: "type_safe_text", target: "element_3", text: "privacy agent" }, request.value);
  const rawPii = validateAgentAction({ action: "type_safe_text", target: "element_3", text: "alice@example.com" }, request.value);
  const modelInvented = validateAgentAction({ action: "type_safe_text", target: "element_3", text: "different text" }, request.value);

  assert.equal(allowed.ok, true);
  assert.equal(rawPii.ok, false);
  assert.equal(modelInvented.ok, false);
});

test("handler validates every planner response before returning it", async () => {
  const result = await handleAgentStep(sanitizedRequest(), {
    async plan() {
      return {
        action: "click",
        target: "element_2",
        javascript: "alert(1)"
      };
    }
  });

  assert.equal(result.status, 422);
  assert.equal(result.body.errors.includes("Executable code fields are not allowed."), true);
});
