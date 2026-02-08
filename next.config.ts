import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    // Avoid Turbopack picking the wrong workspace root when multiple lockfiles exist.
    root: repoRoot,
  },
};

export default nextConfig;
