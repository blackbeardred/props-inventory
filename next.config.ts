import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Photo uploads (Day 4) go through a Server Action; the default 1MB
      // body limit is too small for a phone photo. Leaves headroom above
      // the 8MB file-size check in items/new/actions.ts for multipart
      // overhead.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
