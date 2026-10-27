import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export async function copyStaticFiles() {
  const root = process.cwd();
  const dist = resolve(root, "dist");

  await mkdir(dist, { recursive: true });

  for (const file of ["manifest.json", "popup.html", "popup.css"]) {
    await copyFile(resolve(root, file), resolve(dist, file));
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1:")}`) {
  await copyStaticFiles();
}
