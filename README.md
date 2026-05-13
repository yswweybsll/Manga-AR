# Manga AR

Manga AR 是一个 pnpm workspace monorepo。当前包含 Expo React Native 手机端、Node WebSocket 中继服务、Electron 桌面端骨架，以及顶层 `shared` 共享类型包。

## 环境要求

- **Node.js**（建议 LTS）
- **Android**：Android SDK / JDK，并已配置 `ANDROID_HOME`（构建真机或模拟器运行、打包 APK 时需要）
- **iOS**（仅 macOS）：Xcode

## 安装依赖

在项目根目录安装全部 workspace 依赖：

```bash
pnpm install
```

## 开发运行

手机端：

```bash
pnpm start
# 或
pnpm --filter @manga-ar/mobile start
```

安装到设备 / 模拟器：

```bash
pnpm run android
pnpm run ios
```

中继服务：

```bash
pnpm run relay
# 或
pnpm --filter @manga-ar/relay start
```

桌面端骨架：

```bash
pnpm run studio
# 或
pnpm --filter @manga-ar/studio-desktop dev
```

## 原生工程（prebuild）

本仓库默认 **不把 `android/`、`ios/` 提交到 Git**（见 `.gitignore`）。首次在本机打包或运行原生命令前，需要生成原生目录：

```bash
pnpm run prebuild
```

仅 Android：

```bash
pnpm run prebuild:android
```

`prebuild` 会执行 `expo prebuild --clean`，生成干净的 `android/`、`ios/`。项目已注册本地 Expo config plugin，用于修正 `@reactvision/react-viro` 在 monorepo 下生成的 Android 依赖路径。协作者只要正常跑 `prebuild` 就能得到可构建的原生工程。

## Android 打包（Release APK）

1. 已完成 `pnpm run prebuild:android`（或 `pnpm run prebuild`），确保存在 `android/` 目录。
2. 在项目根目录执行：

```bash
pnpm run android:release
```

等价于在 `android` 目录执行 `gradlew.bat assembleRelease`（Windows）。生成的 APK 位于 `android/app/build/outputs/apk/release/`（具体子路径以 Gradle 输出为准）。

安装 Release 到已连接设备：

```bash
pnpm run android:install-release
```

## 中继服务 relay

用于手机与电脑端页面之间的 WebSocket 中继。

```bash
pnpm run relay
```

## Manga AR Studio（电脑端页面）

桌面端骨架由 `pnpm run studio` 启动；迁移后的静态原型位于 `apps/studio-desktop/prototype/index.html`。

## 说明

- 若使用 **EAS Build** 等云端打包，需在项目中自行添加 `eas.json` 并登录 Expo 账号；当前脚本以 **本地 prebuild + Gradle** 为主。
- Android **包名** 等在 `app.json` 的 `expo.android.package` 等处配置，修改后建议重新执行 `prebuild` 再打包。

## Agent Skills

运行 `scripts/install-agent-skills.ps1` 安装项目用到的 skills 。