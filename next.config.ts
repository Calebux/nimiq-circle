import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets Nimiq Pay load the dev server through `npm run tunnel`.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // The dev badge sits on top of the bottom action bar inside Nimiq Pay.
  devIndicators: false,
  // WASM signer for pool payouts; load it with Node's require, not the bundler.
  serverExternalPackages: ["@nimiq/core"],
};

export default nextConfig;
