const PRECACHE_MANIFEST = "__PRECACHE_MANIFEST__";
const CACHE_PREFIX = "coffee-calculator-";
const POINTER_CACHE_NAME = "coffee-active-pointer";
const { revision, urls } = PRECACHE_MANIFEST;
const CACHE_NAME = `${CACHE_PREFIX}${revision}`;
const SHELL_URL = new URL("/", self.location.origin).href;
const ACTIVE_CACHE_URL = new URL("/__coffee_active_cache__", self.location.origin).href;
const PRECACHE_URLS = new Set(
  urls.map((url) => new URL(url, self.location.origin).href),
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const alreadyExists = (await caches.keys()).includes(CACHE_NAME);
      const cache = await caches.open(CACHE_NAME);
      try {
        await cache.addAll([...PRECACHE_URLS]);
      } catch (error) {
        if (!alreadyExists) await caches.delete(CACHE_NAME);
        throw error;
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      const currentCache = await caches.open(CACHE_NAME);
      if (!(await currentCache.match(SHELL_URL))) {
        throw new Error("The new release cache is incomplete");
      }

      const previousNames = cacheNames.filter(
        (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
      );
      const completePrevious = [];
      for (const name of previousNames) {
        const cache = await caches.open(name);
        const shell = await cache.match(SHELL_URL);
        if (shell) completePrevious.push(name);
      }

      let activePrevious = null;
      const hasPointerCache = cacheNames.includes(POINTER_CACHE_NAME);
      if (hasPointerCache) {
        const pointerCache = await caches.open(POINTER_CACHE_NAME);
        const pointer = await pointerCache.match(ACTIVE_CACHE_URL);
        if (pointer) activePrevious = await pointer.text();
      }
      if (!completePrevious.includes(activePrevious)) {
        activePrevious = completePrevious[0] ?? null;
      }

      // Keep the active predecessor and newest other complete cache (current plus two previous).
      const retained = new Set([CACHE_NAME]);
      if (activePrevious) retained.add(activePrevious);
      let newestOther = null;
      for (let index = completePrevious.length - 1; index >= 0; index -= 1) {
        const name = completePrevious[index];
        if (name !== activePrevious) {
          newestOther = name;
          break;
        }
      }
      if (newestOther) retained.add(newestOther);

      await Promise.all(
        previousNames
          .filter((name) => !retained.has(name))
          .map((name) => caches.delete(name)),
      );

      const pointerCache = await caches.open(POINTER_CACHE_NAME);
      try {
        await pointerCache.put(ACTIVE_CACHE_URL, new Response(CACHE_NAME));
      } catch (error) {
        if (!hasPointerCache) await caches.delete(POINTER_CACHE_NAME);
        throw error;
      }
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    request.headers.has("range") ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  const isRootNavigation =
    request.mode === "navigate" && url.pathname === "/";
  const cacheUrl = isRootNavigation ? SHELL_URL : url.href;
  const isStaticAsset = url.pathname.startsWith("/_next/static/");
  if (!PRECACHE_URLS.has(cacheUrl) && !isStaticAsset) return;


  event.respondWith(
    (async () => {
      const currentCache = await caches.open(CACHE_NAME);
      const currentResponse = await currentCache.match(cacheUrl);
      if (currentResponse) return currentResponse;

      if (isStaticAsset) {
        const cacheNames = await caches.keys();
        for (let index = cacheNames.length - 1; index >= 0; index -= 1) {
          const name = cacheNames[index];
          if (!name.startsWith(CACHE_PREFIX) || name === CACHE_NAME) continue;
          const previousResponse = await (await caches.open(name)).match(cacheUrl);
          if (previousResponse) return previousResponse;
        }
      }

      return fetch(request);
    })(),
  );
});
