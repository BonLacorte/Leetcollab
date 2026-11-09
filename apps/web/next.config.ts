import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: ["@leetcollab/contracts"],
};

export default nextConfig;
