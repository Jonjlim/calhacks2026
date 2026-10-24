import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Lets a phone reach `next dev` through a Cloudflare quick tunnel (dev only; no effect on builds).
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
