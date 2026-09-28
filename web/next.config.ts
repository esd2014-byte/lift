import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Briefs are committed to the repo by the cloud routine and read at request time,
  // so nothing here may be statically cached.
  experimental: {},
  poweredByHeader: false,

  // Baseline headers on every response. The Content Security Policy is set per
  // request in proxy.ts, because it carries a fresh nonce.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // same-origin, not no-referrer: no-referrer makes browsers send "Origin: null"
          // on our own form posts. Other sites still get nothing.
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // The photo picker uses a file input, not the camera API; nothing needs these.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
