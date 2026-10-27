import type { BackgroundAnalyzeResult, PopupAnalyzeRequest } from "./messages";
import { installFailClosedNetworkGuard } from "./privacy-boundary";

installFailClosedNetworkGuard();

const analyzeButton = document.querySelector<HTMLButtonElement>("#analyze-button");
const tabStatus = document.querySelector<HTMLElement>("#tab-status");
const result = document.querySelector<HTMLElement>("#result");

function setResult(text: string): void {
  if (result) {
    result.textContent = text;
  }
}

function setStatus(text: string): void {
  if (tabStatus) {
    tabStatus.textContent = text;
  }
}

function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]);
    });
  });
}

function sendAnalyzeRequest(): Promise<BackgroundAnalyzeResult> {
  const message: PopupAnalyzeRequest = { type: "POPUP_ANALYZE_REQUEST" };

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage<BackgroundAnalyzeResult>(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error?.message) {
        reject(new Error(error.message));
        return;
      }

      resolve(response);
    });
  });
}

async function initializePopup(): Promise<void> {
  const tab = await queryActiveTab();

  if (tab?.id) {
    setStatus(`Active tab detected: ${tab.title ?? "Untitled tab"}`);
    return;
  }

  setStatus("No active tab detected.");
  analyzeButton?.setAttribute("disabled", "true");
}

analyzeButton?.addEventListener("click", async () => {
  analyzeButton.disabled = true;
  setResult("Injecting content script...");

  try {
    const response = await sendAnalyzeRequest();
    const elementCount = response.contentScript?.elements.length ?? 0;
    const piiCount = response.contentScript?.piiDetections.length ?? 0;
    const preview = response.contentScript?.elements.slice(0, 5) ?? [];
    const piiPreview = response.contentScript?.piiDetections.slice(0, 5) ?? [];
    setResult(
      JSON.stringify(
        {
          ...response,
          detectedElements: elementCount,
          piiDetections: piiCount,
          preview,
          piiPreview
        },
        null,
        2
      )
    );
  } catch (error) {
    setResult(error instanceof Error ? error.message : "Analyze request failed.");
  } finally {
    analyzeButton.disabled = false;
  }
});

void initializePopup();
