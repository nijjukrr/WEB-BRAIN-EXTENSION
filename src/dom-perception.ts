export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type NormalizedElement = {
  id: string;
  tag: string;
  domId: string | null;
  classes: string[];
  type: string | null;
  name: string | null;
  placeholder: string | null;
  autocomplete: string | null;
  ariaLabel: string | null;
  label: string | null;
  role: string;
  text: string | null;
  bbox: BoundingBox;
  visible: boolean;
  enabled: boolean;
};

type BrowserWindow = Window & typeof globalThis;

const PERCEIVABLE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "[role]",
  "[aria-label]",
  "[tabindex]",
  "summary",
  "details",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "main",
  "nav",
  "section",
  "article",
  "form"
].join(",");

const TEXT_SAFE_TAGS = new Set([
  "a",
  "button",
  "label",
  "legend",
  "summary",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6"
]);

function cleanText(value: string | null | undefined): string | null {
  const cleaned = value?.replace(/\s+/g, " ").trim() ?? "";
  return cleaned.length > 0 ? cleaned : null;
}

function readAttribute(element: Element, name: string): string | null {
  return cleanText(element.getAttribute(name));
}

function cssEscape(value: string): string {
  if (globalThis.CSS?.escape) {
    return globalThis.CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

function toBoundingBox(rect: DOMRect): BoundingBox {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left
  };
}

function getInputType(element: Element, tag: string): string | null {
  if (tag !== "input") {
    return null;
  }

  return cleanText((element as HTMLInputElement).type) ?? "text";
}

function getClasses(element: Element): string[] {
  return Array.from(element.classList)
    .map((className) => className.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function getAssociatedLabel(element: Element, doc: Document, win: BrowserWindow): string | null {
  if (
    element instanceof win.HTMLInputElement ||
    element instanceof win.HTMLTextAreaElement ||
    element instanceof win.HTMLSelectElement
  ) {
    const labels = Array.from(element.labels ?? [])
      .map((label) => cleanText(label.textContent))
      .filter((label): label is string => Boolean(label));

    if (labels.length > 0) {
      return labels.join(" ");
    }
  }

  const ariaLabelledBy = readAttribute(element, "aria-labelledby");
  if (ariaLabelledBy) {
    const labelledText = ariaLabelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById(id))
      .map((labelElement) => cleanText(labelElement?.textContent))
      .filter((label): label is string => Boolean(label))
      .join(" ");

    if (labelledText) {
      return labelledText;
    }
  }

  const elementId = element.getAttribute("id");
  if (elementId) {
    const explicitLabel = doc.querySelector(`label[for="${cssEscape(elementId)}"]`);
    const labelText = cleanText(explicitLabel?.textContent);
    if (labelText) {
      return labelText;
    }
  }

  const wrappingLabel = element.closest("label");
  return cleanText(wrappingLabel?.textContent);
}

function inferRole(element: Element, tag: string, type: string | null): string {
  const explicitRole = readAttribute(element, "role");
  if (explicitRole) {
    return explicitRole;
  }

  if (tag === "a" && element.hasAttribute("href")) {
    return "link";
  }

  if (tag === "button") {
    return "button";
  }

  if (tag === "textarea") {
    return "textbox";
  }

  if (tag === "select") {
    return "combobox";
  }

  if (tag === "input") {
    switch (type) {
      case "button":
      case "submit":
      case "reset":
        return "button";
      case "checkbox":
        return "checkbox";
      case "radio":
        return "radio";
      case "range":
        return "slider";
      case "email":
      case "number":
      case "password":
      case "search":
      case "tel":
      case "text":
      case "url":
      case null:
        return "textbox";
      default:
        return "input";
    }
  }

  if (/^h[1-6]$/.test(tag)) {
    return "heading";
  }

  if (tag === "form") {
    return "form";
  }

  if (tag === "nav") {
    return "navigation";
  }

  if (tag === "main") {
    return "main";
  }

  if (tag === "section") {
    return "region";
  }

  return "generic";
}

function getSafeText(element: Element, tag: string, role: string, win: BrowserWindow): string | null {
  if (
    element instanceof win.HTMLInputElement ||
    element instanceof win.HTMLTextAreaElement ||
    element instanceof win.HTMLSelectElement
  ) {
    return null;
  }

  if (!TEXT_SAFE_TAGS.has(tag) && role !== "button" && role !== "link" && role !== "heading") {
    return null;
  }

  return cleanText(element.textContent);
}

function isEnabled(element: Element, win: BrowserWindow): boolean {
  if (
    element instanceof win.HTMLButtonElement ||
    element instanceof win.HTMLInputElement ||
    element instanceof win.HTMLSelectElement ||
    element instanceof win.HTMLTextAreaElement ||
    element instanceof win.HTMLOptionElement
  ) {
    return !element.disabled;
  }

  return element.getAttribute("aria-disabled") !== "true";
}

function isVisible(element: Element, rect: DOMRect, win: BrowserWindow): boolean {
  if (element instanceof win.HTMLInputElement && element.type === "hidden") {
    return false;
  }

  if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") {
    return false;
  }

  const style = win.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }

  return rect.width > 0 && rect.height > 0;
}

export function inspectDocument(doc: Document = document): NormalizedElement[] {
  const win = (doc.defaultView ?? window) as BrowserWindow;
  const candidates = Array.from(doc.querySelectorAll<Element>(PERCEIVABLE_SELECTOR));

  return candidates.map((element, index) => {
    const tag = element.tagName.toLowerCase();
    const type = getInputType(element, tag);
    const rect = element.getBoundingClientRect();
    const role = inferRole(element, tag, type);

    return {
      id: `element_${index + 1}`,
      tag,
      domId: readAttribute(element, "id"),
      classes: getClasses(element),
      type,
      name: readAttribute(element, "name"),
      placeholder: readAttribute(element, "placeholder"),
      autocomplete: readAttribute(element, "autocomplete"),
      ariaLabel: readAttribute(element, "aria-label"),
      label: getAssociatedLabel(element, doc, win),
      role,
      text: getSafeText(element, tag, role, win),
      bbox: toBoundingBox(rect),
      visible: isVisible(element, rect, win),
      enabled: isEnabled(element, win)
    };
  });
}
