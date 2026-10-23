import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets Nimiq Pay load the dev server through `npm run tunnel`.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
