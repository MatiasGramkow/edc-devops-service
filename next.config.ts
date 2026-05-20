import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // All Azure DevOps API calls go through server-side route handlers
  // so no external domains need to be exposed to the client
  poweredByHeader: false,
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    },
  ],
};

export default nextConfig;
