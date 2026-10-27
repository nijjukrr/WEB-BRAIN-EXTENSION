import type { NormalizedElement } from "./dom-perception";
import type { PiiDetection } from "./pii-detector";

export type PopupAnalyzeRequest = {
  type: "POPUP_ANALYZE_REQUEST";
};

export type BackgroundAnalyzeResult = {
  type: "BACKGROUND_ANALYZE_RESULT";
  ok: boolean;
  tabId?: number;
  message: string;
  contentScript?: ContentScriptStatus;
};

export type ContentScriptPing = {
  type: "CONTENT_SCRIPT_PING";
};

export type ContentScriptStatus = {
  type: "CONTENT_SCRIPT_STATUS";
  ok: true;
  title: string;
  url: string;
  timestamp: string;
  elements: NormalizedElement[];
  piiDetections: PiiDetection[];
};

export type ExtensionMessage =
  | PopupAnalyzeRequest
  | BackgroundAnalyzeResult
  | ContentScriptPing
  | ContentScriptStatus;

export function isExtensionMessage(message: unknown): message is ExtensionMessage {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return false;
  }

  const type = (message as { type: unknown }).type;

  return (
    type === "POPUP_ANALYZE_REQUEST" ||
    type === "BACKGROUND_ANALYZE_RESULT" ||
    type === "CONTENT_SCRIPT_PING" ||
    type === "CONTENT_SCRIPT_STATUS"
  );
}
