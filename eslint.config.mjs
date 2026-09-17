// Next 16 removed `next lint`, so ESLint runs directly and needs its own flat config.
import { fixupPluginRules } from "@eslint/compat";
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// eslint-config-next still bundles eslint-plugin-react 7.x, which calls the
// `context.getFilename()` API removed in ESLint 10 (jsx-eslint/eslint-plugin-react#3977).
// The ESLint team's own compat shim restores it, so no rules have to be dropped.
const bridgedCoreWebVitals = coreWebVitals.map(entry =>
  entry.plugins?.react
    ? { ...entry, plugins: { ...entry.plugins, react: fixupPluginRules(entry.plugins.react) } }
    : entry
);

const config = [
  { ignores: [".next/**", "out/**", ".vercel/**"] },
  ...bridgedCoreWebVitals,
  ...typescript,
];

export default config;
