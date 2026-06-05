import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  // Same-origin proxy to the self-hosted voice box (RunPod pod udcz4k7kse1zw6).
  // The Pet Concierge embed (data-connect-url="/boxapi") posts /boxapi/api/...
  // to reach the box; the box has no CORS so this MUST stay same-origin.
  // Mirrors the proven SPI/Sugar /boxapi rewrite.
  async rewrites() {
    return [
      {
        source: "/boxapi/:path*",
        destination: "https://udcz4k7kse1zw6-7860.proxy.runpod.net/:path*",
      },
    ];
  },
};

export default nextConfig;
