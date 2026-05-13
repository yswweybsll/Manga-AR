const { withSettingsGradle } = require('expo/config-plugins');
const path = require('node:path');

const VIRO_PACKAGE = '@reactvision/react-viro';
const VIRO_ANDROID_MODULES = [
  'arcore_client',
  'gvr_common',
  'viro_renderer',
  'react_viro',
];

function toGradlePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function getViroAndroidPath(platformProjectRoot) {
  const viroPackageJson = require.resolve(`${VIRO_PACKAGE}/package.json`, {
    paths: [platformProjectRoot],
  });
  const relativePath = path.relative(
    platformProjectRoot,
    path.join(path.dirname(viroPackageJson), 'android')
  );

  return toGradlePath(relativePath);
}

function patchSettingsGradle(contents, viroAndroidPath = '../../../node_modules/@reactvision/react-viro/android') {
  const patchedContents = contents
    .replace(
      /project\(':(arcore_client|gvr_common|viro_renderer|react_viro)'\)\.projectDir = new File\('(?:\.\.\/)+node_modules\/@reactvision\/react-viro\/android\/\1'\)/g,
      (_, moduleName) => `project(':${moduleName}').projectDir = new File('${viroAndroidPath}/${moduleName}')`
    )
    .replace(/\r?\n{3,}/g, '\n\n')
    .trimEnd()
    .concat('\n');

  const hasViroInclude = patchedContents.includes("include ':react_viro', ':arcore_client', ':gvr_common', ':viro_renderer'");
  const hasViroProjectDirs = VIRO_ANDROID_MODULES.every(moduleName => patchedContents.includes(`project(':${moduleName}').projectDir`));

  if (hasViroInclude && hasViroProjectDirs) {
    return patchedContents;
  }

  const includeLine = hasViroInclude ? '' : "\ninclude ':react_viro', ':arcore_client', ':gvr_common', ':viro_renderer'";
  const projectDirLines = hasViroProjectDirs
    ? ''
    : `\n${VIRO_ANDROID_MODULES
    .map(moduleName => `project(':${moduleName}').projectDir = new File('${viroAndroidPath}/${moduleName}')`)
    .join('\n')}`;

  return `${patchedContents.trimEnd()}${includeLine}${projectDirLines}\n`;
}

function withViroAndroidMonorepoPaths(config) {
  config = withSettingsGradle(config, config => {
    const viroAndroidPath = getViroAndroidPath(config.modRequest.platformProjectRoot);
    config.modResults.contents = patchSettingsGradle(config.modResults.contents, viroAndroidPath);

    return config;
  });

  return config;
}

module.exports = withViroAndroidMonorepoPaths;
module.exports.patchSettingsGradle = patchSettingsGradle;
