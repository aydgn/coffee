import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const outputDirectory = fileURLToPath(new URL("../out/", import.meta.url));
const requiredFiles = [
  "index.html",
  "manifest.webmanifest",
  "apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-512-maskable.png",
];

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return nested.flat();
}

function shouldPrecache(path) {
  return (
    path === "index.html" ||
    path === "manifest.webmanifest" ||
    path === "favicon.ico" ||
    path === "apple-touch-icon.png" ||
    path.startsWith("icons/") ||
    path.startsWith("_next/static/")
  );
}

const filePaths = (await listFiles(outputDirectory))
  .map((path) => relative(outputDirectory, path).split(sep).join("/"))
  .filter(shouldPrecache)
  .sort();

for (const requiredFile of requiredFiles) {
  if (!filePaths.includes(requiredFile)) {
    throw new Error(`Static export is missing required PWA asset: ${requiredFile}`);
  }
}
if (!filePaths.some((path) => path.startsWith("_next/static/"))) {
  throw new Error("Static export has no Next.js client assets to precache");
}

const workerTemplate = await readFile(
  fileURLToPath(new URL("../public/sw.js", import.meta.url)),
  "utf8",
);
const revision = createHash("sha256");
revision.update("\0service-worker\0").update(workerTemplate).update("\0");
const urls = [];
for (const path of filePaths) {
  const url = path === "index.html" ? "/" : `/${path}`;
  revision.update(url).update("\0").update(await readFile(join(outputDirectory, path))).update("\0");
  urls.push(url);
}

const manifest = {
  revision: revision.digest("hex"),
  urls,
};
const placeholder = 'const PRECACHE_MANIFEST = "__PRECACHE_MANIFEST__";';
if (
  workerTemplate.indexOf(placeholder) === -1 ||
  workerTemplate.indexOf(placeholder) !== workerTemplate.lastIndexOf(placeholder)
) {
  throw new Error("Service worker must contain exactly one precache placeholder");
}
await writeFile(
  join(outputDirectory, "sw.js"),
  workerTemplate.replace(
    placeholder,
    `const PRECACHE_MANIFEST = ${JSON.stringify(manifest)};`,
  ),
);
