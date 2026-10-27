import { rm } from "node:fs/promises";
import { resolve } from "node:path";

await rm(resolve(process.cwd(), "dist"), { recursive: true, force: true });
await rm(resolve(process.cwd(), "dist-backend"), { recursive: true, force: true });
