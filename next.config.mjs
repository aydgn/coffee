/** @type {import('next').NextConfig} */
// Fully client-side app: a static export is served directly by Cloudflare Pages,
// which removes the need for the deprecated @cloudflare/next-on-pages adapter.
const nextConfig = {
  output: "export",
  // Next 16 infers the Turbopack root from the nearest lockfile and walks past the
  // repo into ~/bun.lock; pin it to this project.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
