import type { BoundingBox } from "../dom-perception";

export type AgentActionType = "click" | "scroll" | "focus" | "type_safe_text";

export type AllowedInteraction = {
  elementId: string;
  actions: AgentActionType[];
  safeText?: string;
};

export type BackendSanitizedElement = {
  id: string;
  tag: string;
  role: string;
  label: string | null;
  text: string | null;
  placeholder: string | null;
  redacted: boolean;
  enabled: boolean;
  visible: boolean;
  bbox: BoundingBox;
};

export type ContextRepresentation = "dom_only" | "screenshot_with_element_map" | "focused_visual_context";

export type AgentStepRequest = {
  userTask: string;
  contextRepresentation: ContextRepresentation;
  sanitizedScreenshot?: string | null;
  sanitizedElementMap: BackendSanitizedElement[];
  allowedInteractions: AllowedInteraction[];
};

export type AgentAction = {
  action: AgentActionType;
  target: string;
  text?: string;
};

export type AgentStepResponse = AgentAction;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

const ACTIONS = new Set<AgentActionType>(["click", "scroll", "focus", "type_safe_text"]);
const REPRESENTATIONS = new Set<ContextRepresentation>(["dom_only", "screenshot_with_element_map", "focused_visual_context"]);
const PLACEHOLDER_RE = /<([A-Z_]+)_\d+>/g;
const RAW_PII_PATTERNS = [
  /[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/i,
  /(?:\+?91[\s-]?)?[6-9]\d{9}\b/,
  /(?:\d[ -]*?){13,19}/,
  /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/,
  /\b[A-Z]{5}[0-9]{4}[A-Z]\b/i,
  /\b[a-z0-9.\-_]{2,256}@(oksbi|okaxis|okhdfcbank|okicici|ybl|ibl|axl|paytm|apl|upi)\b/i,
  /\b(?:sk|pk|api|key|token|secret|ghp|gho|ghu|github_pat)[A-Za-z0-9_\-]{16,}\b/i
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateBox(value: unknown): value is BoundingBox {
  return (
    isRecord(value) &&
    isNumber(value.x) &&
    isNumber(value.y) &&
    isNumber(value.width) &&
    isNumber(value.height) &&
    isNumber(value.top) &&
    isNumber(value.right) &&
    isNumber(value.bottom) &&
    isNumber(value.left)
  );
}

function stripPlaceholders(value: string): string {
  return value.replace(PLACEHOLDER_RE, "");
}

export function containsRawPii(value: unknown): boolean {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return RAW_PII_PATTERNS.some((pattern) => pattern.test(stripPlaceholders(serialized)));
}

function validateSanitizedElement(value: unknown, index: number, errors: string[]): BackendSanitizedElement | null {
  if (!isRecord(value)) {
    errors.push(`sanitizedElementMap[${index}] must be an object.`);
    return null;
  }

  if (
    !isString(value.id) ||
    !isString(value.tag) ||
    !isString(value.role) ||
    !nullableString(value.label) ||
    !nullableString(value.text) ||
    !nullableString(value.placeholder) ||
    !isBoolean(value.redacted) ||
    !isBoolean(value.enabled) ||
    !isBoolean(value.visible) ||
    !validateBox(value.bbox)
  ) {
    errors.push(`sanitizedElementMap[${index}] has invalid fields.`);
    return null;
  }

  return {
    id: value.id,
    tag: value.tag,
    role: value.role,
    label: value.label,
    text: value.text,
    placeholder: value.placeholder,
    redacted: value.redacted,
    enabled: value.enabled,
    visible: value.visible,
    bbox: value.bbox
  };
}

function validateAllowedInteraction(value: unknown, index: number, errors: string[]): AllowedInteraction | null {
  if (!isRecord(value)) {
    errors.push(`allowedInteractions[${index}] must be an object.`);
    return null;
  }

  if (!isString(value.elementId) || !Array.isArray(value.actions) || value.actions.some((action) => !ACTIONS.has(action))) {
    errors.push(`allowedInteractions[${index}] has invalid elementId or actions.`);
    return null;
  }

  if (value.safeText !== undefined && !isString(value.safeText)) {
    errors.push(`allowedInteractions[${index}].safeText must be a string when present.`);
    return null;
  }

  return {
    elementId: value.elementId,
    actions: value.actions,
    safeText: value.safeText
  };
}

export function validateAgentStepRequest(value: unknown): ValidationResult<AgentStepRequest> {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  if (!isString(value.userTask) || value.userTask.trim().length === 0) {
    errors.push("userTask is required.");
  }

  const contextRepresentation = value.contextRepresentation ?? "screenshot_with_element_map";
  if (!isString(contextRepresentation) || !REPRESENTATIONS.has(contextRepresentation as ContextRepresentation)) {
    errors.push("contextRepresentation is invalid.");
  }

  if (
    contextRepresentation !== "dom_only" &&
    (!isString(value.sanitizedScreenshot) || !value.sanitizedScreenshot.startsWith("data:image/"))
  ) {
    errors.push("sanitizedScreenshot must be an image data URL for visual context modes.");
  }

  if (contextRepresentation === "dom_only" && value.sanitizedScreenshot !== undefined && value.sanitizedScreenshot !== null) {
    errors.push("DOM-only context must not include a screenshot.");
  }

  if (!Array.isArray(value.sanitizedElementMap)) {
    errors.push("sanitizedElementMap must be an array.");
  }

  if (!Array.isArray(value.allowedInteractions)) {
    errors.push("allowedInteractions must be an array.");
  }

  if (containsRawPii(value)) {
    errors.push("Request contains raw PII-like data and was rejected.");
  }

  const sanitizedElementMap = Array.isArray(value.sanitizedElementMap)
    ? value.sanitizedElementMap.flatMap((element, index) => {
        const parsed = validateSanitizedElement(element, index, errors);
        return parsed ? [parsed] : [];
      })
    : [];

  const allowedInteractions = Array.isArray(value.allowedInteractions)
    ? value.allowedInteractions.flatMap((interaction, index) => {
        const parsed = validateAllowedInteraction(interaction, index, errors);
        return parsed ? [parsed] : [];
      })
    : [];

  const elementIds = new Set(sanitizedElementMap.map((element) => element.id));
  for (const interaction of allowedInteractions) {
    if (!elementIds.has(interaction.elementId)) {
      errors.push(`allowedInteractions target does not exist: ${interaction.elementId}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const userTask = value.userTask;
  const sanitizedScreenshot = value.sanitizedScreenshot;
  if (!isString(userTask) || !isString(contextRepresentation)) {
    return { ok: false, errors: ["Validated request lost required string fields."] };
  }

  return {
    ok: true,
    value: {
      userTask,
      contextRepresentation: contextRepresentation as ContextRepresentation,
      sanitizedScreenshot: isString(sanitizedScreenshot) ? sanitizedScreenshot : null,
      sanitizedElementMap,
      allowedInteractions
    }
  };
}

function hasExecutableShape(value: Record<string, unknown>): boolean {
  return "code" in value || "javascript" in value || "script" in value || "eval" in value;
}

export function validateAgentAction(value: unknown, request: AgentStepRequest): ValidationResult<AgentStepResponse> {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["Model action must be a JSON object."] };
  }

  if (hasExecutableShape(value)) {
    errors.push("Executable code fields are not allowed.");
  }

  if (!ACTIONS.has(value.action as AgentActionType)) {
    errors.push("Unsupported action.");
  }

  if (!isString(value.target)) {
    errors.push("Action target is required.");
  }

  const action = value.action as AgentActionType;
  const target = isString(value.target) ? value.target : "";
  const allowed = request.allowedInteractions.find((interaction) => interaction.elementId === target);

  if (!allowed || !allowed.actions.includes(action)) {
    errors.push("Action is not allowed for the requested target.");
  }

  if (action === "type_safe_text") {
    if (!isString(value.text) || value.text.length === 0) {
      errors.push("type_safe_text requires text.");
    } else if (containsRawPii(value.text)) {
      errors.push("type_safe_text cannot contain raw PII-like text.");
    } else if (allowed?.safeText !== value.text) {
      errors.push("type_safe_text must match locally supplied safeText.");
    }
  } else if ("text" in value) {
    errors.push("Only type_safe_text may include text.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const response: AgentStepResponse = { action, target };
  if (action === "type_safe_text" && isString(value.text)) {
    response.text = value.text;
  }

  return { ok: true, value: response };
}
