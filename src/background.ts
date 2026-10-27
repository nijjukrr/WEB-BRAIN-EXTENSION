import type {
  BackgroundAnalyzeResult,
  ContentScriptPing,
  ContentScriptStatus,
  PopupAnalyzeRequest
} from "./messages";
import { installFailClosedNetworkGuard } from "./privacy-boundary";
import { isExtensionMessage } from "./messages";

installFailClosedNetworkGuard();

function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]);
    });
  });
}

function injectContentScript(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ["content.js"]
      },
      () => {
        const error = chrome.runtime.lastError;
        if (error?.message) {
          reject(new Error(error.message));
          return;
        }

        resolve();
      }
    );
  });
}

function pingContentScript(tabId: number): Promise<ContentScriptStatus> {
  const message: ContentScriptPing = { type: "CONTENT_SCRIPT_PING" };

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage<ContentScriptStatus>(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error?.message) {
        reject(new Error(error.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error("Content script did not return a valid status."));
        return;
      }

      resolve(response);
    });
  });
}

async function analyzeActiveTab(): Promise<BackgroundAnalyzeResult> {
  const tab = await getActiveTab();

  if (!tab?.id) {
    return {
      type: "BACKGROUND_ANALYZE_RESULT",
      ok: false,
      message: "No active tab was detected."
    };
  }

  await injectContentScript(tab.id);
  const contentScript = await pingContentScript(tab.id);

  return {
    type: "BACKGROUND_ANALYZE_RESULT",
    ok: true,
    tabId: tab.id,
    message: "Content script injected and communication verified.",
    contentScript
  };
}

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    if (!isExtensionMessage(message) || message.type !== "POPUP_ANALYZE_REQUEST") {
      return false;
    }

    analyzeActiveTab()
      .then(sendResponse)
      .catch((error: unknown) => {
        const response: BackgroundAnalyzeResult = {
          type: "BACKGROUND_ANALYZE_RESULT",
          ok: false,
          message: error instanceof Error ? error.message : "Analyze request failed."
        };

        sendResponse(response);
      });

    return true;
  }
);
