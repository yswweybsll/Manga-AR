# Manga AR

基于 Expo（React Native）与 `@reactvision/react-viro` 的 AR 应用；仓库内还包含 WebSocket 中继服务与电脑端调试页面。

## 环境要求

- **Node.js**（建议 LTS）
- **Android**：Android SDK / JDK，并已配置 `ANDROID_HOME`（构建真机或模拟器运行、打包 APK 时需要）
- **iOS**（仅 macOS）：Xcode

## 安装依赖

在项目根目录：

```bash
npm install
```

中继服务（可选，本地联调时使用）：

```bash
cd relay-server
npm install
```

## 开发运行

```bash
npm start
```

上述命令等价于 `expo start --dev-client`，需配合 **Development Build（开发客户端）** 使用：手机上安装的是你自己打包出来的 dev client，而不是 Expo Go。

安装到设备 / 模拟器（会先按需编译原生工程）：

```bash
npm run android
# 或
npm run ios
```

Web 预览（若业务支持）：

```bash
npm run web
```

## 原生工程（prebuild）

本仓库默认 **不把 `android/`、`ios/` 提交到 Git**（见 `.gitignore`）。首次在本机打包或运行原生命令前，需要生成原生目录：

```bash
npm run prebuild
```

仅 Android：

```bash
npm run prebuild:android
```

`prebuild` 会执行 `expo prebuild --clean`，生成干净的 `android/`、`ios/`。之后即可使用下面的 Gradle 打包命令。

## Android 打包（Release APK）

1. 已完成 `npm run prebuild:android`（或 `npm run prebuild`），确保存在 `android/` 目录。
2. 在项目根目录执行：

```bash
npm run android:release
```

等价于在 `android` 目录执行 `gradlew.bat assembleRelease`（Windows）。生成的 APK 位于 `android/app/build/outputs/apk/release/`（具体子路径以 Gradle 输出为准）。

安装 Release 到已连接设备：

```bash
npm run android:install-release
```

## 中继服务 relay-server

用于手机与电脑端页面之间的 WebSocket 中继（与 `manga-ar-studio` 等配合）。

```bash
cd relay-server
node index.js
```

默认端口等逻辑见 `relay-server/index.js`，可按需修改。

## Manga AR Studio（电脑端页面）

`manga-ar-studio/index.html` 为静态页面，可用浏览器直接打开；若页面内请求受浏览器跨域限制，可在该目录下用任意静态服务器访问，例如：

```bash
npx --yes serve manga-ar-studio -p 5173
```

将页面里的 Relay 地址改为实际运行的 `ws://` 地址即可。

## 说明

- 若使用 **EAS Build** 等云端打包，需在项目中自行添加 `eas.json` 并登录 Expo 账号；当前脚本以 **本地 prebuild + Gradle** 为主。
- Android **包名** 等在 `app.json` 的 `expo.android.package` 等处配置，修改后建议重新执行 `prebuild` 再打包。
