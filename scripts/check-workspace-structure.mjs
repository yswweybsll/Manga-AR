import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const requiredPaths = [
  'apps/mobile/package.json',
  'apps/relay/package.json',
  'apps/studio-desktop/package.json',
  'shared/package.json',
  'shared/src/index.ts',
];

const forbiddenSharedDeps = [
  '@reactvision/react-viro',
  'expo',
  'expo-file-system',
  'expo-media-library',
  'expo-status-bar',
  'expo-system-ui',
  'react',
  'react-native',
  'electron',
  'three',
  'ws',
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function assertPathExists(relativePath) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    throw new Error(`Missing required path: ${relativePath}`);
  }
}

function assertDependency(packageJsonPath, dependencyName) {
  const pkg = readJson(packageJsonPath);
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  };
  if (!deps[dependencyName]) {
    throw new Error(`${packageJsonPath} must depend on ${dependencyName}`);
  }
}

for (const relativePath of requiredPaths) {
  assertPathExists(relativePath);
}

assertDependency('apps/mobile/package.json', '@manga-ar/shared');
assertDependency('apps/relay/package.json', '@manga-ar/shared');
assertDependency('apps/studio-desktop/package.json', '@manga-ar/shared');

const sharedPkg = readJson('shared/package.json');
const sharedDeps = {
  ...sharedPkg.dependencies,
  ...sharedPkg.devDependencies,
  ...sharedPkg.peerDependencies,
};

for (const dep of forbiddenSharedDeps) {
  if (sharedDeps[dep]) {
    throw new Error(`shared/package.json must not depend on ${dep}`);
  }
}

console.log('Workspace structure check passed.');
