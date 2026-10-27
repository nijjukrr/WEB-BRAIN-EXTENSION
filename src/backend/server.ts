import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { handleAgentStep } from "./agent-step";

const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    request.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    request.on("error", reject);
  });
}

export function createAgentApiServer() {
  return createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/agent/step") {
      sendJson(response, 404, { errors: ["Not found."] });
      return;
    }

    try {
      const body = await readJson(request);
      const result = await handleAgentStep(body);
      sendJson(response, result.status, result.body);
    } catch (error) {
      sendJson(response, 400, {
        errors: [error instanceof Error ? error.message : "Invalid request."]
      });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  createAgentApiServer().listen(port, () => {
    console.log(`Agent API listening on http://localhost:${port}`);
  });
}
