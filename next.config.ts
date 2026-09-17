import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /**
   * BullMQ يستورد عملاء Redis بديلين اختياريين، فيحاول المحزّم حلّها
   * ويحذّر. وهو يعمل على الخادم فقط أصلًا، فلا داعي لحزمه.
   */
  serverExternalPackages: ["bullmq", "ioredis"],
};

export default nextConfig;
