import type { AgentActionType } from "./backend/schemas";
import type { BoundingBox } from "./dom-perception";
import type { SanitizedElement } from "./redaction-engine";

export type ServerAction = {
  action: AgentActionType;
  target: string;
  text?: string;
};

export type LocalAllowedInteraction = {
  elementId: string;
  actions: AgentActionType[];
  safeText?: string;
  snapshotHash: string;
  requiresConfirmation?: boolean;
};

export type ValidationDecision =
  | {
      status: "execute";
      action: ServerAction;
      target: SanitizedElement;
      reasons: string[];
    }
  | {
      status: "requires_confirmation";
      action: ServerAction;
      target: SanitizedElement;
      reasons: string[];
    }
  | {
      status: "reject";
      action: ServerAction;
      target: SanitizedElement | null;
      reasons: string[];
    };

const DANGEROUS_TERMS = [
  "pay",
  "payment",
  "purchase",
  "buy",
  "order now",
  "checkout",
  "transfer",
  "send money",
  "delete",
  "remove account",
  "close account",
  "change password",
  "update password",
  "account settings",
  "submit application",
  "submit form",
  "confirm"
];

const INTERACTIVE_ROLES = new Set(["button", "link", "textbox", "combobox", "checkbox", "radio", "slider", "input"]);
const INTERACTIVE_TAGS = new Set(["button", "a", "input", "select", "textarea", "summary"]);

function normalize(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
}

function boxSignature(box: BoundingBox): string {
  return [box.left, box.top, box.width, box.height].map((value) => Math.round(value)).join(",");
}

export function createElementSnapshotHash(element: SanitizedElement): string {
  return hashString(
    JSON.stringify({
      id: element.id,
      tag: element.tag,
      role: element.role,
      label: element.label,
      text: element.text,
      placeholder: element.placeholder,
      redacted: element.redacted,
      enabled: element.enabled,
      visible: element.visible,
      bbox: boxSignature(element.bbox)
    })
  );
}

function isCurrentlyInteractive(element: SanitizedElement): boolean {
  return (
    element.visible &&
    element.enabled &&
    (INTERACTIVE_ROLES.has(element.role) || INTERACTIVE_TAGS.has(element.tag) || element.role === "generic")
  );
}

function targetText(element: SanitizedElement): string {
  return normalize([element.label, element.text, element.placeholder, element.role, element.tag].filter(Boolean).join(" "));
}

function isDangerousTarget(element: SanitizedElement, action: ServerAction): boolean {
  const text = targetText(element);
  if (DANGEROUS_TERMS.some((term) => text.includes(term))) {
    return true;
  }

  if (action.action === "click" && element.redacted) {
    return true;
  }

  if (action.action === "type_safe_text" && element.redactionTypes.some((type) => ["PASSWORD", "CARD", "CVV", "OTP"].includes(type))) {
    return true;
  }

  return false;
}

function violatesPrivacyPolicy(element: SanitizedElement, action: ServerAction): string | null {
  if (action.action === "type_safe_text") {
    if (!action.text) {
      return "type_safe_text requires locally approved safe text.";
    }

    if (element.redactionTypes.some((type) => ["PASSWORD", "CARD", "CVV", "OTP", "AADHAAR", "PAN", "UPI"].includes(type))) {
      return "Typing into high-sensitivity redacted targets is blocked by default.";
    }
  }

  if (action.action === "click" && element.redacted && element.redactionTypes.length > 0) {
    return "Clicking redacted sensitive targets is blocked by default.";
  }

  return null;
}

export function validateLocalAction(input: {
  action: ServerAction;
  elements: SanitizedElement[];
  allowedInteractions: LocalAllowedInteraction[];
  userConfirmedDangerousAction?: boolean;
}): ValidationDecision {
  const reasons: string[] = [];
  const target = input.elements.find((element) => element.id === input.action.target) ?? null;

  if (!target) {
    return { status: "reject", action: input.action, target, reasons: ["Target does not exist."] };
  }

  if (!target.visible) {
    reasons.push("Target is not visible.");
  }

  if (!target.enabled) {
    reasons.push("Target is disabled.");
  }

  if (!isCurrentlyInteractive(target)) {
    reasons.push("Target is not currently interactive.");
  }

  const allowed = input.allowedInteractions.find((interaction) => interaction.elementId === input.action.target);
  if (!allowed || !allowed.actions.includes(input.action.action)) {
    reasons.push("Action type is not allowed for this target.");
  }

  if (allowed && allowed.snapshotHash !== createElementSnapshotHash(target)) {
    reasons.push("Target changed unexpectedly since sanitization.");
  }

  if (input.action.action === "type_safe_text" && allowed?.safeText !== input.action.text) {
    reasons.push("Typed text does not match locally approved safe text.");
  }

  const privacyViolation = violatesPrivacyPolicy(target, input.action);
  if (privacyViolation) {
    reasons.push(privacyViolation);
  }

  if (reasons.length > 0) {
    return { status: "reject", action: input.action, target, reasons };
  }

  if (allowed?.requiresConfirmation || isDangerousTarget(target, input.action)) {
    if (input.userConfirmedDangerousAction) {
      return { status: "execute", action: input.action, target, reasons: ["Dangerous action was explicitly confirmed by the user."] };
    }

    return {
      status: "requires_confirmation",
      action: input.action,
      target,
      reasons: ["Dangerous action requires explicit user confirmation."]
    };
  }

  return { status: "execute", action: input.action, target, reasons: ["Action passed local validation."] };
}
