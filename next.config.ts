import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['*.dev.coze.site'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
        pathname: '/**',
      },
    ],
  },
  // Disable React strict double-mounting in dev.
  // Causes loadDataset() to fire twice on page mount, which flashes
  // "loading..." → data → "loading..." → data, looking like auto-refresh.
  reactStrictMode: false,
  webpack: (config, { dev }) => {
    // In dev, the Python backend writes runtime data into the project root
    // (.dataset-store/, .milvus-data.db/, .model-cache/) during uploads and
    // embedding jobs. Next's file watcher picks up those writes, recompiles,
    // and triggers an HMR/full reload — which re-runs loadDataset() and looks
    // like the dataset reloading at random intervals. Ignore them.
    //
    // This webpack version only accepts a non-empty string, a string[], or a
    // single RegExp for `watchOptions.ignored` (no predicate function). Next's
    // default is a RegExp covering node_modules/.git/.next, which can't be
    // mixed into a glob-string array. We replace it with an equivalent glob
    // array plus our runtime dirs so every entry is a valid non-empty string.
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/.next/**',
          '**/.dataset-store/**',
          '**/.milvus-data.db/**',
          '**/.model-cache/**',
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
