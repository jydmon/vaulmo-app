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

module.exports = config;
