import type { ContentScriptPing, ContentScriptStatus } from "./messages";
import { inspectDocument } from "./dom-perception";
import { isExtensionMessage } from "./messages";
import { detectPiiInDocument } from "./pii-detector";
import { installFailClosedNetworkGuard } from "./privacy-boundary";

installFailClosedNetworkGuard();

function createStatus(): ContentScriptStatus {
  return {
    type: "CONTENT_SCRIPT_STATUS",
    ok: true,
    title: document.title,
    url: window.location.href,
    timestamp: new Date().toISOString(),
    elements: inspectDocument(document),
    piiDetections: detectPiiInDocument(document)
  };
}

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    if (!isExtensionMessage(message) || message.type !== "CONTENT_SCRIPT_PING") {
      return false;
    }

    const _ping: ContentScriptPing = message;
    sendResponse(createStatus());
    return false;
  }
);
