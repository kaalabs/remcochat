import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["http://127.0.0.1:3000", "http://localhost:3000"],
  // Turbopack currently struggles with some bundled/native assets pulled in by bash-tool
  // (via just-bash -> @mongodb-js/zstd). These packages are server-only and safe to externalize.
  serverExternalPackages: ["bash-tool", "just-bash", "@mongodb-js/zstd"],
};

export default nextConfig;
