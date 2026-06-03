import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow Next.js Image component to serve from our own photo proxy route
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.vercel.app',
      },
      {
        protocol: 'https',
        hostname: 'shop.flexxo.com.my',
      },
      {
        protocol: 'https',
        hostname: 'crm.flexxo.com.my',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
      {
        protocol: 'http',
        hostname: 'shop.localhost',
      },
    ],
  },
};

export default nextConfig;
