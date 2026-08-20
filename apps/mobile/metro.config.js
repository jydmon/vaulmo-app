const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Monorepo-aware Metro config: watch the workspace root and resolve hoisted
// node_modules so EAS Build can bundle apps/mobile inside the npm-workspaces repo.
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
// Pin the Metro server root to the app folder. Without this, watching the
// monorepo root makes Metro treat the repo root as the server root, so the
// release build's relative `--entry-file index.ts` (passed by EAS/Gradle) is
// resolved against the repo root and fails ("Unable to resolve ./index.ts").
config.server = { ...(config.server || {}), unstable_serverRoot: projectRoot };

module.exports = config;
