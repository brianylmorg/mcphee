import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client"],
  // Lets an installed app know which release it is running (see AppUpdateWatcher).
  env: { NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
