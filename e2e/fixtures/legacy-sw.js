// Shipped before the cache-first update fix (introduced in eb414c4).
const PRECACHE_MANIFEST = "__PRECACHE_MANIFEST__";
const CACHE_PREFIX = "coffee-calculator-";
const { revision, urls } = PRECACHE_MANIFEST;
const CACHE_NAME = `${CACHE_PREFIX}${revision}`;
const SHELL_URL = new URL("/", self.location.origin).href;
const PRECACHE_URLS = new Set(
  urls.map((url) => new URL(url, self.location.origin).href),
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([...PRECACHE_URLS])),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter(
            (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
          )
          .map((name) => caches.delete(name)),
      ),
    ),
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

  const cacheUrl =
    request.mode === "navigate" && url.pathname === "/" ? SHELL_URL : url.href;
  if (!PRECACHE_URLS.has(cacheUrl)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      return (await cache.match(cacheUrl)) ?? fetch(request);
    }),
  );
});
