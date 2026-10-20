# Coffee Calculator

A single-screen, dark, mobile-first coffee-to-water calculator. It supports calculating coffee from water or water from coffee, with quick amount and ratio presets and a custom ratio.

## Calculator

- The default water mode starts at 250 ml and 1:16, which calculates 15.6 g of coffee; switching to coffee mode starts at 15 g.
- Water presets: 250, 500, and 750 ml. Coffee presets: 15, 30, and 45 g. Ratio presets: 1:15 through 1:18.
- Custom amounts accept a dot or comma decimal separator, up to three decimal places. Water range: 1–10,000 ml; coffee range: 0.1–1,000 g; ratio range: 1–100.
- Empty, incomplete, or invalid input does not show a false zero result. Valid amount and custom-ratio edits are saved to local storage as you type, not only on blur; missing, corrupt, or unavailable storage falls back to usable defaults.
- On first load the amount field is focused with its value selected, so typing replaces it. Mobile browsers may not open the keyboard without a tap.
- Saved preference changes sync across open tabs; a changed saved value replaces a stale draft for that field without disturbing unrelated in-progress edits.
- The custom ratio is a native expandable disclosure. Its summary keeps the saved value visible when collapsed, for example `Custom ratio (1:15.5)`.
- The optional bloom-water figure is an estimate of about twice the coffee dose, not a required recipe.
- Controls use at least 44 px touch targets, labeled inputs and accessible status feedback. The layout accounts for device safe areas. The calculator stays on one screen; it does not include timers, named recipe management, or brewer-capacity configuration.
- Below 640 px, the calculator fills the available width with at least 16 px safe-area-aware screen-edge spacing and starts at the top; from 640 px up, the centered card returns.

## Development and checks

Use Node.js 24 or newer (the repository pins `24` in `.node-version`; Wrangler Pages
requires Node.js 22+). If you use fnm, run `fnm install 24 && fnm use 24` from the
repository root before the Bun commands below.

Install dependencies and start the development server with Bun:

```bash
bun install
bun run dev
```

Run the calculator unit tests directly with Bun:

```bash
bun test lib/brew.test.ts
```

Other project checks are available as scripts:

```bash
bun run lint
bun run typecheck
```

Install the Chromium browser once for the browser tests, then run the end-to-end suite:

```bash
bunx playwright install chromium
bun run test:e2e
```

`bun run test:e2e` builds `out/` and starts `bun run preview` on `127.0.0.1:8791`, so it uses the project-local Wrangler and never needs a global install. It runs every `e2e/*.e2e.ts` file in two Chromium projects: desktop and Pixel 7 mobile emulation. The `pwa.e2e.ts` lifecycle test instead serves temporary releases from an isolated HTTP server on an ephemeral port, separate from the suite's Wrangler preview: it checks first-visit precaching, offline calculation (300 ml → 18.8 g), background installation and activation of a new release while an old tab stays open, the next normal load showing the new release, retained drafts and saved preferences in the old tab, a partial download that leaves the old release intact, and offline fallback for hashed assets from a retained previous cache. The Bun unit runner ignores `*.e2e.ts` files, so `bun run test:unit` stays separate.

```bash
bun run test:unit
```

## Static build and Cloudflare Pages

The app is a Next.js static export. Build it before starting the local Cloudflare Pages preview:

```bash
bun run build
bun run preview
```

`bun run build` writes the deployable site to `out/` and uses the exported root page, Next.js static assets, manifest, favicon, and icons to generate a SHA-256 revision and exact precache list inside `out/sw.js`. Worker template bytes are included in that revision digest, so a worker-only change produces a new cache. Hashed Next.js paths are not maintained by hand.

For Cloudflare Pages Git integration, use the repository root, build command `bun run build`, and build output directory `out`. For a manual Pages upload after building, deploy the same output directory:

The Cloudflare build image needs Bun 1.4.3 to read the v2 `bun.lock` in frozen installs. Keep `BUN_VERSION = "1.4.3"` in Wrangler's `[vars]`; this shared setting covers production and preview builds.

```bash
bunx wrangler pages deploy out --project-name coffee-to-water-ratio-calculator
```

The existing preview script serves `out/` with Wrangler Pages locally. Production hosting must use HTTPS for service-worker registration.

## Installability and browser constraints

The web app manifest provides a standalone app identity and generated icons, including a maskable icon and Apple touch icon. Service-worker registration is limited to production builds in secure contexts (HTTPS or `localhost`); `bun run dev` deliberately does not register it. Browser and operating-system install affordances vary. On iOS/iPadOS, use Safari's Share menu and **Add to Home Screen**, then validate the experience on the target device. The app does not request notifications or show an unsolicited install prompt.

### Offline use and updates

- **First online visit:** load the site once over HTTPS or `localhost`. The worker precaches the exact shell, static assets, manifest, and icons listed in `out/sw.js`. Installation is all-or-nothing, so a partial download never activates. The worker does not take over open pages, so the first load is uncontrolled; reload once after activation before relying on offline behavior.
- **Offline opening:** once the worker controls the page, reloading or opening the site without a network serves the cached shell. Calculation runs entirely in the browser, and saved preferences load from local storage.
- **Updates:** a new deployment installs in the background while the site keeps serving its cached version. The worker calls `skipWaiting` only after every precache entry downloads, so a partial download never replaces the active release. The page registers `/sw.js` on entry, which lets the browser check for a changed worker script, and calls `registration.update()` explicitly only when the tab becomes visible. Open tabs are not reloaded, so drafts and saved preferences in them are kept. The new release appears on the next normal page load or reload; the worker does not claim open pages. After activation, previous caches are pruned to the active predecessor plus the newest other complete cache, and their hashed assets still serve offline when the new release lacks them.
- **Test coverage:** Automated lifecycle tests run in desktop and mobile Chromium emulation against the isolated HTTP server described above.
- **Asset retention limit:** the worker keeps the current release plus at most two previous complete releases for hashed-asset fallback. The app is eager and does not promise arbitrary lazy-loaded asset references across unlimited releases; revisit if routes are added.
- **Verified limits:** A separate manual offline check used Chromium against the local Wrangler Pages preview; that is not Cloudflare's edge. Browsers that loaded the site before this worker shipped run the older worker. That worker checks the new script during normal entry or the browser's own update check. On first entry it may keep serving the old shell while the new release prepares; the next refresh after the release is ready returns the new version. Safari, iOS Home Screen installs, and physical devices were not tested.
