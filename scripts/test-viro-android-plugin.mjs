import assert from 'node:assert/strict';
import { patchSettingsGradle } from '../apps/mobile/plugins/withViroAndroidMonorepoPaths.js';

const generatedSettingsGradle = `
include ':app'
includeBuild(expoAutolinking.reactNativeGradlePlugin)

include ':react_viro', ':arcore_client', ':gvr_common', ':viro_renderer'
project(':arcore_client').projectDir = new File('../node_modules/@reactvision/react-viro/android/arcore_client')
project(':gvr_common').projectDir = new File('../node_modules/@reactvision/react-viro/android/gvr_common')
project(':viro_renderer').projectDir = new File('../node_modules/@reactvision/react-viro/android/viro_renderer')
project(':react_viro').projectDir = new File('../node_modules/@reactvision/react-viro/android/react_viro')
`;

const viroAndroidPath = '../../../node_modules/@reactvision/react-viro/android';
const patchedSettingsGradle = patchSettingsGradle(generatedSettingsGradle, viroAndroidPath);
assert.match(
  patchedSettingsGradle,
  /include ':react_viro', ':arcore_client', ':gvr_common', ':viro_renderer'/
);
assert.match(
  patchedSettingsGradle,
  /project\(':react_viro'\)\.projectDir = new File\('\.\.\/\.\.\/\.\.\/node_modules\/@reactvision\/react-viro\/android\/react_viro'\)/
);
assert.match(
  patchedSettingsGradle,
  /project\(':arcore_client'\)\.projectDir = new File\('\.\.\/\.\.\/\.\.\/node_modules\/@reactvision\/react-viro\/android\/arcore_client'\)/
);
assert.equal(patchedSettingsGradle.includes("implementation files("), false);
assert.equal(patchSettingsGradle(patchedSettingsGradle), patchedSettingsGradle);
