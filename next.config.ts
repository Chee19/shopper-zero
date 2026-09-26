import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // playwright-core reads browsers.json at runtime; file tracing misses it (scan probes via Browserbase).
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/playwright-core/browsers.json"],
  },
};

export default nextConfig;
