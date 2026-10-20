import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
type Release = { root: string; marker: string; html: string; manifest: PrecacheManifest };

async function readPrecacheManifest(swPath: string): Promise<PrecacheManifest> {
  const source = await readFile(swPath, "utf8");
  const match = /^const PRECACHE_MANIFEST = (\{.*\});$/m.exec(source);
  if (!match) throw new Error(`No generated precache manifest in ${swPath}`);
  return JSON.parse(match[1]) as PrecacheManifest;
}

async function createRelease(
  workDir: string,
  marker: string,
  workerTemplate: string,
  omittedAssets: string[] = [],
): Promise<Release> {
  const builtOut = join(repoRoot, "out");
  try {
    await readFile(join(builtOut, "sw.js"));
  } catch {
    throw new Error("Run `bun run build` before the e2e tests: out/sw.js is missing");
  }

  const project = join(workDir, `${marker}-project`);
  const outRoot = join(project, "out");
  await cp(builtOut, outRoot, { recursive: true });
  await mkdir(join(project, "public"), { recursive: true });
  await mkdir(join(project, "scripts"), { recursive: true });
  await writeFile(join(project, "public", "sw.js"), workerTemplate);
  await cp(join(repoRoot, "scripts", "generate-precache.mjs"), join(project, "scripts", "generate-precache.mjs"));

  const htmlPath = join(outRoot, "index.html");
  const html = (await readFile(htmlPath, "utf8")).replace(
    "</head>",
    `<meta name="coffee-release" content="${marker}"></head>`,
  );
  await writeFile(htmlPath, html);
  for (const assetUrl of omittedAssets) {
    await rm(join(outRoot, assetUrl.slice(1)), { force: true });
  }

  await execFileAsync(process.execPath, [join(project, "scripts", "generate-precache.mjs")], { cwd: project });
  return {
    root: outRoot,
    marker,
    html,
    manifest: await readPrecacheManifest(join(outRoot, "sw.js")),
  };
}


// Static server whose served release can be switched, as a deploy would do.
async function startReleaseServer() {
  let activeRoot = "";
  const inFlightCounts = new Map<string, number>();
  const requestCounts = new Map<string, number>();
  const server: Server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    inFlightCounts.set(pathname, (inFlightCounts.get(pathname) ?? 0) + 1);
    let completed = false;
    const completeRequest = () => {
      if (completed) return;
      completed = true;
      const remaining = (inFlightCounts.get(pathname) ?? 1) - 1;
      if (remaining === 0) inFlightCounts.delete(pathname);
      else inFlightCounts.set(pathname, remaining);
    };
    response.once("finish", completeRequest);
    response.once("close", completeRequest);
    requestCounts.set(pathname, (requestCounts.get(pathname) ?? 0) + 1);
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
    requestCount(pathname: string) {
      return requestCounts.get(pathname) ?? 0;
    },
    inFlightCount(pathname: string) {
      return inFlightCounts.get(pathname) ?? 0;
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
      installing: registration?.installing?.state ?? null,
      waiting: registration?.waiting?.state ?? null,
      controlled: navigator.serviceWorker.controller !== null,
    };
  });
}

async function cacheNames(page: Page) {
  return page.evaluate(() => caches.keys());
}
async function cacheHasShell(page: Page, cacheName: string) {
  return page.evaluate(async name => {
    const cache = await caches.open(name);
    return Boolean(await cache.match(new URL("/", location.origin).href));
  }, cacheName);
}

function htmlRelease(html: string) {
  return /<meta name="coffee-release" content="([^"]+)"/.exec(html)?.[1];
}

async function bodyRelease(response: { text(): Promise<string> } | null) {
  if (!response) throw new Error("Navigation returned no response");
  return htmlRelease(await response.text());
}
function unreferencedStaticScript(release: Release) {
  const referenced = new Set(
    [...release.html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]),
  );
  const script = release.manifest.urls.find(
    url => url.startsWith("/_next/static/") && url.endsWith(".js") && !referenced.has(url),
  );
  if (!script) throw new Error("The release has no unreferenced precached static script");
  return script;
}

async function waitForWaitingRelease(
  page: Page,
  versionStatuses: () => string[],
  cacheName: string,
  redundantCount: number,
) {
  await expect.poll(async () => {
    const [state, caches] = await Promise.all([registrationState(page), cacheNames(page)]);
    const targetHasShell = caches.includes(cacheName) && await cacheHasShell(page, cacheName);
    const statuses = versionStatuses();
    return (
      targetHasShell &&
      state.waiting === "installed" &&
      statuses.includes("installed") &&
      statuses.filter(status => status === "redundant").length >= redundantCount
    );
  }, { timeout: 30_000 }).toBe(true);
}

async function waitForActivatedRelease(
  page: Page,
  versionStatuses: () => string[],
  cacheName: string,
  redundantCount: number,
) {
  await expect.poll(async () => {
    const [state, caches] = await Promise.all([registrationState(page), cacheNames(page)]);
    const targetHasShell = caches.includes(cacheName) && await cacheHasShell(page, cacheName);
    const statuses = versionStatuses();
    return (
      targetHasShell &&
      state.active === "activated" &&
      state.installing === null &&
      state.waiting === null &&
      statuses.includes("activated") &&
      statuses.filter(status => status === "redundant").length >= redundantCount
    );
  }, { timeout: 30_000 }).toBe(true);
}
async function waitForFailedRelease(
  page: Page,
  versionStatuses: () => string[],
  cacheName: string,
) {
  await expect.poll(async () => {
    const [state, caches] = await Promise.all([registrationState(page), cacheNames(page)]);
    return (
      state.active === "activated" &&
      state.installing === null &&
      state.waiting === null &&
      !caches.includes(cacheName) &&
      versionStatuses().includes("redundant")
    );
  }, { timeout: 30_000 }).toBe(true);
}

const result = (page: Page) => page.locator('section[aria-labelledby="result-heading"] [role=status]');

test("a returning legacy client gets the complete release on the next normal reload with other tabs open", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000);
  const workDir = await mkdtemp(join(tmpdir(), "coffee-pwa-"));
  const server = await startReleaseServer();
  const pageErrors: string[] = [];
  try {
    const legacyWorker = await readFile(join(repoRoot, "e2e", "fixtures", "legacy-sw.js"), "utf8");
    const currentWorker = await readFile(join(repoRoot, "public", "sw.js"), "utf8");
    const v1 = await createRelease(workDir, "v1", legacyWorker);
    const oldAssetUrl = unreferencedStaticScript(v1);
    const oldAssetBody = await readFile(join(v1.root, oldAssetUrl.slice(1)), "utf8");
    const v2 = await createRelease(workDir, "v2", legacyWorker, [oldAssetUrl]);
    const v3 = await createRelease(workDir, "v3", legacyWorker, [oldAssetUrl]);
    const v4 = await createRelease(workDir, "v4", currentWorker, [oldAssetUrl]);
    const cacheName = (release: Release) => `coffee-calculator-${release.manifest.revision}`;
    const v1Cache = cacheName(v1);
    const v2Cache = cacheName(v2);
    const v3Cache = cacheName(v3);
    const v4Cache = cacheName(v4);
    expect(new Set([v1Cache, v2Cache, v3Cache, v4Cache]).size).toBe(4);
    const versionStatuses = await observeServiceWorkerVersions(context);

    server.publish(v1.root);
    page.on("pageerror", error => pageErrors.push(error.message));

    expect(await bodyRelease(await page.goto(server.origin + "/"))).toBe("v1");
    await expect.poll(() => registrationState(page)).toMatchObject({
      active: "activated",
      installing: null,
      waiting: null,
      controlled: false,
    });
    expect(await cacheNames(page)).toContain(v1Cache);

    await page.reload();
    await expect.poll(() => registrationState(page)).toMatchObject({ controlled: true });
    await page.getByLabel("Water (ml)", { exact: true }).fill("300");
    await page.getByRole("button", { name: "1:16", exact: true }).click();
    await expect(result(page)).toHaveText("18.8 grams");

    const otherTab = await context.newPage();
    otherTab.on("pageerror", error => pageErrors.push(error.message));
    expect(await bodyRelease(await otherTab.goto(server.origin + "/"))).toBe("v1");
    await expect.poll(() => registrationState(otherTab)).toMatchObject({ controlled: true });
    await otherTab.getByLabel("Water (ml)", { exact: true }).fill("300,");
    await expect(otherTab.getByLabel("Water (ml)", { exact: true })).toHaveValue("300,");

    await context.setOffline(true);
    expect(await bodyRelease(await page.reload())).toBe("v1");
    await expect(result(page)).toHaveText("18.8 grams");
    await context.setOffline(false);

    server.publish(v2.root);
    expect(await bodyRelease(await page.reload())).toBe("v1");
    await waitForWaitingRelease(page, versionStatuses, v2Cache, 0);

    server.publish(v3.root);
    expect(await bodyRelease(await page.reload())).toBe("v1");
    await waitForWaitingRelease(page, versionStatuses, v3Cache, 1);
    expect((await cacheNames(page)).sort()).toEqual([v1Cache, v2Cache, v3Cache].sort());

    server.publish(v4.root);
    expect(await bodyRelease(await page.reload())).toBe("v1");
    await waitForActivatedRelease(page, versionStatuses, v4Cache, 3);

    expect(await bodyRelease(await page.reload())).toBe("v4");
    await expect(result(page)).toHaveText("18.8 grams");
    await expect(page.getByLabel("Water (ml)", { exact: true })).toHaveValue("300");
    await expect(page.getByRole("button", { name: "1:16", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(otherTab.getByLabel("Water (ml)", { exact: true })).toHaveValue("300,");

    await context.setOffline(true);
    for (const oldClient of [page, otherTab]) {
      const response = await oldClient.evaluate(async assetUrl => {
        try {
          const asset = await fetch(assetUrl);
          return { status: asset.status, body: await asset.text() };
        } catch {
          return { status: 0, body: "" };
        }
      }, oldAssetUrl);
      expect(response).toEqual({ status: 200, body: oldAssetBody });
    }
    expect(await bodyRelease(await page.reload())).toBe("v4");
    await expect(result(page)).toHaveText("18.8 grams");
    await expect(otherTab.getByLabel("Water (ml)", { exact: true })).toHaveValue("300,");
    const storedCaches = await cacheNames(page);
    expect(storedCaches.filter(name => name.startsWith("coffee-calculator-")).sort()).toEqual(
      [v1Cache, v3Cache, v4Cache].sort(),
    );
    expect(pageErrors).toEqual([]);
  } finally {
    await server.close();
    await rm(workDir, { recursive: true, force: true });
  }
});
test("a failed background download keeps the offline release and retries on return", async ({
  context,
  page,
}) => {
  test.setTimeout(90_000);
  const workDir = await mkdtemp(join(tmpdir(), "coffee-pwa-failure-"));
  const server = await startReleaseServer();
  try {
    const worker = await readFile(join(repoRoot, "public", "sw.js"), "utf8");
    const v1 = await createRelease(workDir, "v1", worker);
    const v2 = await createRelease(workDir, "v2", worker);
    const v1Cache = `coffee-calculator-${v1.manifest.revision}`;
    const v2Cache = `coffee-calculator-${v2.manifest.revision}`;
    const requiredAssetUrl = v2.manifest.urls.find(
      url => url.startsWith("/_next/static/") && url.endsWith(".js"),
    );
    if (!requiredAssetUrl) throw new Error("The release has no required JavaScript asset");
    const requiredAssetPath = join(v2.root, requiredAssetUrl.slice(1));
    const requiredAssetBody = await readFile(requiredAssetPath);
    await rm(requiredAssetPath);
    const requestCountBeforeUpdate = server.requestCount(requiredAssetUrl);
    const versionStatuses = await observeServiceWorkerVersions(context);

    server.publish(v1.root);
    expect(await bodyRelease(await page.goto(server.origin + "/"))).toBe("v1");
    await expect.poll(() => registrationState(page)).toMatchObject({
      active: "activated",
      installing: null,
      waiting: null,
      controlled: false,
    });
    await page.reload();
    await expect.poll(() => registrationState(page)).toMatchObject({ controlled: true });
    await page.getByLabel("Water (ml)", { exact: true }).fill("300");
    await page.getByRole("button", { name: "1:16", exact: true }).click();
    await expect(result(page)).toHaveText("18.8 grams");

    server.publish(v2.root);
    expect(await bodyRelease(await page.reload())).toBe("v1");
    await expect.poll(() => server.requestCount(requiredAssetUrl)).toBeGreaterThan(requestCountBeforeUpdate);
    await waitForFailedRelease(page, versionStatuses, v2Cache);
    expect(await cacheNames(page)).toContain(v1Cache);
    expect(await cacheNames(page)).not.toContain(v2Cache);

    server.publish(v1.root);
    await context.setOffline(true);
    expect(await bodyRelease(await page.reload())).toBe("v1");
    await expect(result(page)).toHaveText("18.8 grams");
    await context.setOffline(false);

    await writeFile(requiredAssetPath, requiredAssetBody);
    server.publish(v2.root);
    expect(await bodyRelease(await page.reload())).toBe("v1");
    await waitForActivatedRelease(page, versionStatuses, v2Cache, 1);

    expect(await bodyRelease(await page.reload())).toBe("v2");
    await expect(result(page)).toHaveText("18.8 grams");
    await expect(page.getByLabel("Water (ml)", { exact: true })).toHaveValue("300");
    await context.setOffline(true);
    expect(await bodyRelease(await page.reload())).toBe("v2");
    await expect(result(page)).toHaveText("18.8 grams");
  } finally {
    await server.close();
    await rm(workDir, { recursive: true, force: true });
  }
});
test("a visible current client prepares the release without replacing an unfinished edit", async ({
  context,
  page,
}) => {
  test.setTimeout(90_000);
  const workDir = await mkdtemp(join(tmpdir(), "coffee-pwa-foreground-"));
  const server = await startReleaseServer();
  try {
    const worker = await readFile(join(repoRoot, "public", "sw.js"), "utf8");
    const v1 = await createRelease(workDir, "v1", worker);
    const v2 = await createRelease(workDir, "v2", worker);
    const v2Cache = `coffee-calculator-${v2.manifest.revision}`;
    const versionStatuses = await observeServiceWorkerVersions(context);

    server.publish(v1.root);
    expect(await bodyRelease(await page.goto(server.origin + "/"))).toBe("v1");
    await expect.poll(() => registrationState(page)).toMatchObject({
      active: "activated",
      installing: null,
      waiting: null,
      controlled: false,
    });
    await page.getByLabel("Water (ml)", { exact: true }).fill("300");
    await page.getByRole("button", { name: "1:16", exact: true }).click();
    await expect(result(page)).toHaveText("18.8 grams");
    await page.getByLabel("Water (ml)", { exact: true }).fill("300,");
    await expect(page.getByLabel("Water (ml)", { exact: true })).toHaveValue("300,");
    await expect.poll(() => server.requestCount("/sw.js")).toBeGreaterThan(0);
    await expect.poll(() => server.inFlightCount("/sw.js")).toBe(0);
    const requestCountBeforeVisibility = server.requestCount("/sw.js");

    server.publish(v2.root);
    // Headless Chromium keeps each target visible; deliver the browser visibility event, not update().
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => server.requestCount("/sw.js")).toBeGreaterThan(requestCountBeforeVisibility);
    await waitForActivatedRelease(page, versionStatuses, v2Cache, 1);
    await expect(page.locator('meta[name="coffee-release"]')).toHaveAttribute("content", "v1");
    await expect(page.getByLabel("Water (ml)", { exact: true })).toHaveValue("300,");

    expect(await bodyRelease(await page.reload())).toBe("v2");
    await expect(page.getByLabel("Water (ml)", { exact: true })).toHaveValue("300");
    await expect(result(page)).toHaveText("18.8 grams");
  } finally {
    await server.close();
    await rm(workDir, { recursive: true, force: true });
  }
});
