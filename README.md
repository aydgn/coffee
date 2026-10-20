# Coffee Calculator

A single-screen, dark, mobile-first coffee-to-water calculator. It supports calculating coffee from water or water from coffee, with quick amount and ratio presets and a custom ratio.

## Calculator

- The default water mode starts at 250 ml and 1:16, which calculates 15.6 g of coffee; switching to coffee mode starts at 15 g.
- Water presets: 250, 500, and 750 ml. Coffee presets: 15, 30, and 45 g. Ratio presets: 1:15 through 1:18.
- Custom amounts accept a dot or comma decimal separator, up to three decimal places. Water range: 1–10,000 ml; coffee range: 0.1–1,000 g; ratio range: 1–100.
- Empty, incomplete, or invalid input does not show a false zero result. Valid amount and custom-ratio edits are saved to local storage as you type, not only on blur; missing, corrupt, or unavailable storage falls back to usable defaults.
- The custom ratio is a native expandable disclosure. Its summary keeps the saved value visible when collapsed, for example `Custom ratio (1:15.5)`.
- The optional bloom-water figure is an estimate of about twice the coffee dose, not a required recipe.
- Controls use at least 44 px touch targets, labeled inputs and accessible status feedback. The layout accounts for device safe areas. The calculator stays on one screen; it does not include timers, named recipe management, or brewer-capacity configuration.

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

## Static build and Cloudflare Pages

The app is a Next.js static export. Build it before starting the local Cloudflare Pages preview:

```bash
bun run build
bun run preview
```

`bun run build` writes the deployable site to `out/` and uses the exported root page, Next.js static assets, manifest, favicon, and icons to generate a SHA-256 revision and exact precache list inside `out/sw.js`. Hashed Next.js paths are not maintained by hand.

For Cloudflare Pages Git integration, use the repository root, build command `bun run build`, and build output directory `out`. For a manual Pages upload after building, deploy the same output directory:

```bash
bunx wrangler pages deploy out --project-name coffee-to-water-ratio-calculator
```

The existing preview script serves `out/` with Wrangler Pages locally. Production hosting must use HTTPS for service-worker registration.

## Installability and browser constraints

The web app manifest provides a standalone app identity and generated icons, including a maskable icon and Apple touch icon. Service-worker registration is limited to production builds in secure contexts (HTTPS or `localhost`); `bun run dev` deliberately does not register it. Browser and operating-system install affordances vary. On iOS/iPadOS, use Safari's Share menu and **Add to Home Screen**, then validate the experience on the target device. The app does not request notifications or show an unsolicited install prompt.

### Offline use and updates

- **First online visit:** load the site once over HTTPS or `localhost`. The worker precaches the exact shell, static assets, manifest, and icons listed in `out/sw.js`. Installation is all-or-nothing, so a partial download never activates. The worker does not take over open pages, so the first load is uncontrolled; reload once after activation before relying on offline behavior.
- **Offline opening:** once the worker controls the page, reloading or opening the site without a network serves the cached shell. Calculation runs entirely in the browser, and saved preferences load from local storage.
- **Updates:** a new deployment installs in the background and waits while any open tab from the previous version remains. That tab keeps working from its cached version. After those tabs close, the new worker activates and the previous version's caches are deleted; open the site again to load the new version.
- **Verified limits:** offline behavior was checked in a Chromium-based browser against a local Wrangler Pages preview, which is not Cloudflare's edge. Safari, iOS Home Screen installs, and physical devices were not tested.
