import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, sep } from "node:path";
import { promisify } from "node:util";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// Production service-worker lifecycle. Uses an isolated copy of the built `out/`
// and a temporary release built by the real generator; the repo is never modified.

const repoRoot = join(__dirname, "..");
const execFileAsync = promisify(execFile);

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

type PrecacheManifest = { revision: string; urls: string[] };

async function readPrecacheManifest(swPath: string): Promise<PrecacheManifest> {
  const source = await readFile(swPath, "utf8");
  const match = /^const PRECACHE_MANIFEST = (\{.*\});$/m.exec(source);
  if (!match) throw new Error(`No generated precache manifest in ${swPath}`);
  return JSON.parse(match[1]) as PrecacheManifest;
}

async function createReleases(workDir: string) {
  const builtOut = join(repoRoot, "out");
  try {
    await readFile(join(builtOut, "sw.js"));
  } catch {
    throw new Error("Run `bun run build` before the e2e tests: out/sw.js is missing");
  }

  const v1Root = join(workDir, "v1");
  await cp(builtOut, v1Root, { recursive: true });

  // Second release: same generator, same worker template, different shell title.
  const project = join(workDir, "v2-project");
  await cp(builtOut, join(project, "out"), { recursive: true });
  await cp(join(repoRoot, "public", "sw.js"), join(project, "public", "sw.js"), { recursive: true });
  await cp(join(repoRoot, "scripts", "generate-precache.mjs"), join(project, "scripts", "generate-precache.mjs"));
  const indexPath = join(project, "out", "index.html");
  const indexHtml = await readFile(indexPath, "utf8");
  if (!/<title>[^<]*<\/title>/.test(indexHtml)) throw new Error("No <title> in index.html");
  const releaseHtml = indexHtml.replace(/<title>[^<]*<\/title>/, "<title>Coffee Calculator v2</title>");
  await writeFile(indexPath, releaseHtml);
  await execFileAsync(process.execPath, [join(project, "scripts", "generate-precache.mjs")], { cwd: project });

  return {
    v1Root,
    v2Root: join(project, "out"),
    v1Title: htmlTitle(indexHtml),
    v2Title: htmlTitle(releaseHtml),
    v1: await readPrecacheManifest(join(v1Root, "sw.js")),
    v2: await readPrecacheManifest(join(project, "out", "sw.js")),
  };
}

// Static server whose served release can be switched, as a deploy would do.
async function startReleaseServer() {
  let activeRoot = "";
  const server: Server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
    const filePath = join(activeRoot, relativePath);
    if (!filePath.startsWith(activeRoot + sep)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(filePath);
      response.writeHead(200, {
        "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    publish(root: string) {
      activeRoot = root;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    },
  };
}

// Service-worker versions as Chromium reports them. A blank page is not a client,
// so it never keeps the old worker alive.
async function observeServiceWorkerVersions(context: BrowserContext) {
  const probe = await context.newPage();
  const cdp = await context.newCDPSession(probe);
  const statuses = new Map<string, string>();
  cdp.on("ServiceWorker.workerVersionUpdated", (event: { versions: { versionId: string; status: string }[] }) => {
    for (const version of event.versions) statuses.set(version.versionId, version.status);
  });
  await cdp.send("ServiceWorker.enable");
  return () => [...statuses.values()].sort();
}

async function registrationState(page: Page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      active: registration?.active?.state ?? null,
      waiting: registration?.waiting?.state ?? null,
      controlled: navigator.serviceWorker.controller !== null,
    };
  });
}

async function cacheNames(page: Page) {
  return page.evaluate(() => caches.keys());
}

// The <title> in a navigation response body: the release the server actually returned.
function htmlTitle(html: string) {
  return html.match(/<title>([^<]*)<\/title>/)?.[1];
}

async function bodyTitle(response: { text(): Promise<string> } | null) {
  if (!response) throw new Error("Navigation returned no response");
  return htmlTitle(await response.text());
}

const result = (page: Page) => page.locator('section[aria-labelledby="result-heading"] [role=status]');

async function expectOfflineCalculation(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: "Coffee-to-Water Ratio Calculator" })).toBeVisible();
  await page.getByLabel("Water (ml)").fill("500");
  await expect(result(page)).toHaveText("31.3 grams");
  await page.getByLabel("Water (ml)").fill("300");
  await expect(result(page)).toHaveText("18.8 grams");
}

test("production worker precaches, serves offline, and activates an update after old tabs close", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000);
  const workDir = await mkdtemp(join(tmpdir(), "coffee-pwa-"));
  const server = await startReleaseServer();
  const pageErrors: string[] = [];
  try {
    const releases = await createReleases(workDir);
    const v1Cache = `coffee-calculator-${releases.v1.revision}`;
    const v2Cache = `coffee-calculator-${releases.v2.revision}`;
    expect(v2Cache).not.toBe(v1Cache);
    const versionStatuses = await observeServiceWorkerVersions(context);

    server.publish(releases.v1Root);
    page.on("pageerror", error => pageErrors.push(error.message));

    // First visit: the worker installs and activates, but does not control this page.
    expect(await bodyTitle(await page.goto(server.origin + "/"))).toBe(releases.v1Title);
    await expect.poll(() => registrationState(page)).toEqual({ active: "activated", waiting: null, controlled: false });
    expect(await cacheNames(page)).toEqual([v1Cache]);

    // Reload: the page is controlled and calculates online.
    await page.reload();
    await expect.poll(() => registrationState(page)).toMatchObject({ controlled: true });
    await page.getByLabel("Water (ml)").fill("300");
    await expect(result(page)).toHaveText("18.8 grams");

    // Offline reload is served from the precache.
    await context.setOffline(true);
    expect(await bodyTitle(await page.reload())).toBe(releases.v1Title);
    await expectOfflineCalculation(page);

    // Update: the new revision installs and waits while the old tab stays open.
    server.publish(releases.v2Root);
    await context.setOffline(false);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
    await expect.poll(versionStatuses).toEqual(["activated", "installed"]);
    await expect.poll(() => registrationState(page)).toEqual({ active: "activated", waiting: "installed", controlled: true });

    // Old tab reloads while the new worker waits: it still gets the old release and stays usable.
    expect(await bodyTitle(await page.reload())).toBe(releases.v1Title);
    await expect(result(page)).toHaveText("18.8 grams");
    expect((await cacheNames(page)).sort()).toEqual([v1Cache, v2Cache].sort());

    // Old tab closes: the waiting worker activates, and the old cache is deleted.
    await page.close();
    await expect.poll(versionStatuses).toEqual(["activated", "redundant"]);

    const next = await context.newPage();
    next.on("pageerror", error => pageErrors.push(error.message));
    expect(await bodyTitle(await next.goto(server.origin + "/"))).toBe(releases.v2Title);
    await expect.poll(() => registrationState(next)).toMatchObject({ waiting: null, controlled: true });
    expect(await cacheNames(next)).toEqual([v2Cache]);

    await context.setOffline(true);
    expect(await bodyTitle(await next.reload())).toBe(releases.v2Title);
    await expectOfflineCalculation(next);
    expect(pageErrors).toEqual([]);
  } finally {
    await server.close();
    await rm(workDir, { recursive: true, force: true });
  }
});
