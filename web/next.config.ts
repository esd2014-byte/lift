import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Briefs are committed to the repo by the cloud routine and read at request time,
  // so nothing here may be statically cached.
  experimental: {},
};

export default nextConfig;
