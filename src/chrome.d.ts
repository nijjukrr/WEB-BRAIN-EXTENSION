declare namespace chrome {
  namespace runtime {
    const lastError: { message?: string } | undefined;

    function sendMessage<TResponse = unknown>(
      message: unknown,
      callback?: (response: TResponse) => void
    ): void;

    const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void
        ) => boolean | void
      ): void;
    };

    type MessageSender = {
      tab?: tabs.Tab;
    };
  }

  namespace tabs {
    type Tab = {
      id?: number;
      title?: string;
      url?: string;
    };

    function query(
      queryInfo: { active?: boolean; currentWindow?: boolean },
      callback: (tabs: Tab[]) => void
    ): void;

    function sendMessage<TResponse = unknown>(
      tabId: number,
      message: unknown,
      callback?: (response: TResponse) => void
    ): void;
  }

  namespace scripting {
    function executeScript(
      injection: {
        target: { tabId: number };
        files: string[];
      },
      callback?: () => void
    ): void;
  }
}
