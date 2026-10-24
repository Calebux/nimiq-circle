import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets Nimiq Pay load the dev server through `npm run tunnel`.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // The dev badge sits on top of the bottom action bar inside Nimiq Pay.
  devIndicators: false,
  // WASM signer for pool payouts; load it with Node's require, not the bundler.
  serverExternalPackages: ["@nimiq/core"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
