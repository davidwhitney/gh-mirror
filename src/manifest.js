import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";

const MANIFEST_DIR = ".gh-mirror";
const MANIFEST_FILE = "manifest.json";

function manifestPath(basePath) {
  return join(basePath, MANIFEST_DIR, MANIFEST_FILE);
}

export async function loadManifest(basePath) {
  try {
    const data = await readFile(manifestPath(basePath), "utf-8");
    return JSON.parse(data);
  } catch {
    return { orgs: [], concurrency: 10 };
  }
}

export async function manifestExists(basePath) {
  try {
    await access(manifestPath(basePath));
    return true;
  } catch {
    return false;
  }
}

export async function saveManifest(basePath, manifest) {
  const dir = join(basePath, MANIFEST_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(manifestPath(basePath), JSON.stringify(manifest, null, 2) + "\n");
}
