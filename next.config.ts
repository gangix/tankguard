import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The pre-seeded, investigated database is a runtime asset, not a module import.
  // Explicit tracing keeps it with every server-rendered page and API function on Vercel.
  outputFileTracingIncludes: {
    "/*": ["./data/tankguard.db"],
  },
};

export default nextConfig;
