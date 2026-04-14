import type { NextConfig } from "next";

// Cast to NextConfig — outputFileTracingIncludes is valid at runtime but
// missing from the type definitions in this Next.js version.
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/quotes/transform": [
      "./node_modules/pdf-parse/dist/**",
      "./public/onepoint-logo.png",
    ],
  },
} as NextConfig;

export default nextConfig;
