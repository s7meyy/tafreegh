import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // رفع الملفات الكبيرة يمر عبر مسار مخصّص لا عبر Server Actions
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
