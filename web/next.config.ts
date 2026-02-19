import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { resolve } from "path";

// Next.js only auto-loads .env from web/, but ours lives in the parent workspace.
// Read DEV_HOSTNAME from the parent .env so allowedDevOrigins works in dev.
function getParentEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  try {
    const content = readFileSync(resolve(process.cwd(), '..', '.env'), 'utf-8');
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

const devHostname = getParentEnv('DEV_HOSTNAME');

const nextConfig: NextConfig = {
  // Standalone output for npm distribution (self-contained server)
  output: "standalone",
  // Only include devHostname in dev mode — production builds should not leak infra details
  ...(process.env.NODE_ENV !== 'production' && {
    allowedDevOrigins: [
      "localhost",
      "127.0.0.1",
      ...(devHostname ? [devHostname] : []),
    ],
  }),
  // Silence Turbopack/webpack config conflict (Next.js 16 defaults to Turbopack)
  turbopack: {},
  webpack: (config, { dev }) => {
    if (dev) {
      // API routes write to directories outside web/ (documentation/, store/, data/).
      // Without this exclusion, Next.js watches those files as dependencies and
      // triggers spurious Fast Refresh rebuilds on every write.
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          '**/node_modules/**',
          '**/documentation/**',
          '**/store/**',
          '**/data/**',
          '**/.archive/**',
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
