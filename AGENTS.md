# Repository Guidelines

## Project Structure & Module Organization

Manga AR is a pnpm workspace monorepo with packages declared in `pnpm-workspace.yaml` as `apps/*` and `shared`. The workspace uses hoisted `node_modules`; avoid assumptions that dependencies live only inside a package folder.

- `apps/mobile`: Expo React Native app in TypeScript. Entry points are `index.ts` and `App.tsx`. The app currently loads model metadata from `src/api/models.ts` and `src/mock/models.ts`, caches model assets, opens `ModelLibraryScreen`, then drives AR placement through `ARPlacementScreen` and `scenes/ModelPlacementScene.tsx`.
- `apps/mobile/plugins/withViroAndroidMonorepoPaths.js`: local Expo config plugin that patches generated Android Gradle settings for `@reactvision/react-viro` in the monorepo layout. Keep this plugin in sync with Viro Android module names.
- `apps/relay`: Node HTTP and WebSocket relay. `src/server.ts` serves a status page at `/`, serves the migrated static Studio prototype at `/studio`, and relays JSON sync messages by `session` room while remembering the latest scene snapshot.
- `apps/studio-desktop`: desktop Studio work area. The Vite/React renderer lives under `src/renderer`; Electron main/preload code lives under `electron/`; desktop-domain placeholders live under `src/main`; the migrated static prototype is `prototype/index.html` and is also served by the relay.
- `shared`: platform-neutral TypeScript contracts for model assets, scene documents, and sync messages. It must stay free of Expo, React Native, Electron, Three.js, and `ws` runtime dependencies.
- `scripts`: repository maintenance scripts, including workspace boundary checks and Viro Android plugin tests.

## Build, Test, and Development Commands

- `pnpm install`: installs all workspace dependencies from the repository root.
- `pnpm start` or `pnpm --filter @manga-ar/mobile start`: starts Expo with the development client.
- `pnpm run android` / `pnpm run ios`: runs the mobile app on a native device or simulator.
- `pnpm run web`: starts the Expo web target for the mobile workspace.
- `pnpm run prebuild`: runs `expo prebuild --clean` for mobile.
- `pnpm run prebuild:android`: runs a clean Android-only Expo prebuild.
- `pnpm run android:release`: builds the generated Android project with `gradlew.bat assembleRelease`.
- `pnpm run android:install-release`: installs the generated Android release build on a connected device.
- `pnpm run relay`: starts the relay on `PORT` or `3001`; open `http://localhost:3001/studio` for the relay-served static Studio prototype.
- `pnpm run studio`: starts the Studio Vite renderer dev server on `127.0.0.1`; this is separate from the relay-served prototype.
- `pnpm --filter @manga-ar/studio-desktop build`: builds the Studio Vite app.
- `pnpm run typecheck`: runs TypeScript checks for shared, mobile, relay, and desktop.
- `pnpm run check:structure`: verifies required package paths and shared-package dependency boundaries.
- `pnpm run test:viro-android-plugin`: tests the local Viro Android monorepo config plugin.

When running final verification in an environment where `package.json` has no `packageManager` field, prefer existing project scripts or local binaries that do not introduce unrelated metadata changes.

## Coding Style & Naming Conventions

Use strict TypeScript for app code. Follow the existing React Native style in mobile code: functional components, hooks, `StyleSheet.create`, two-space indentation, single quotes, semicolons, and named exports for reusable screens/services. Name React components in `PascalCase`, functions and variables in `camelCase`, and type definitions in `PascalCase`.

Keep user-facing Chinese copy consistent with nearby UI text. Existing comments in mobile sync and AR files are Chinese; keep related comments Chinese while preserving technical identifiers such as `SyncService`, `SceneSnapshotMessage`, and `@reactvision/react-viro`.

## UI Libraries And React Skills

- Desktop React UI work uses `shadcn/ui`. Before creating, modifying, debugging, or reviewing `shadcn/ui` components or related composition in `apps/studio-desktop`, always invoke the `shadcn` skill and follow its workflow.
- Mobile React Native UI work uses `react-native-paper`. Before implementing or refactoring Paper-based UI in `apps/mobile`, consult the official LLM index at `https://github.com/callstack/react-native-paper/blob/main/docs/static/llms.txt`, then use the linked guides and component docs instead of relying on memory.
- Before writing React code, invoke the applicable Vercel React skill for the target surface:
  - `vercel-react-best-practices` for desktop/web React and general React performance patterns.
  - `vercel-react-native-skills` for React Native or Expo code in `apps/mobile`.
  - `vercel-react-view-transitions` whenever the task involves View Transitions, route/page transitions, shared element transitions, or animated React state changes built on that API.
- If multiple React skills apply, use the minimal combination that matches the task, and prefer checking the relevant skill before editing code.

## Mobile AR Implementation Notes

`ARPlacementScreen` owns most current mobile AR behavior: model selection, placement at the aim point, dragging, joystick movement and rotation, scale/height adjustment, multi-select, recent-scene save/restore, screenshot/video capture, and optional WebSocket sync. Keep large UI changes localized and check that overlay panels remain usable on small screens.

Model assets are represented by `RemoteModel` and `CachedModelAsset`. Until a real backend is configured, `fetchModels()` returns `mockModels`; do not add network assumptions without keeping the mock path working.

Scene persistence uses `sceneStorage`, and asset downloads use `modelCache`. Prefer updating these services over duplicating storage or cache logic inside React components.

## Sync and Relay Notes

The shared sync contract lives in `shared/src/sync/index.ts`. The mobile `syncService` sends throttled `scene_snapshot` messages, reconnects automatically, and sends ping messages. The relay groups clients by `session` query parameter, broadcasts messages to other clients in the same room, and sends the remembered latest snapshot to newly connected clients.

The default mobile sync config is `ws://127.0.0.1:3001` with session `room1`; real device testing usually needs a LAN IP address instead of localhost. Keep IP addresses and local relay endpoints out of committed source unless they are placeholders.

## Testing Guidelines

Before submitting structural or shared-contract changes, run:

```bash
pnpm run check:structure
pnpm run typecheck
```

For changes touching the Viro config plugin or Android prebuild behavior, run:

```bash
pnpm run test:viro-android-plugin
pnpm run prebuild:android
```

For mobile AR changes, manually exercise the affected flow through `pnpm start` or `pnpm run android`, especially placement, model switching, capture, save/restore, and sync status if touched. For relay changes, run `pnpm run relay`, verify `/` and `/studio`, and test at least two WebSocket clients in the same session when message routing changes. For Studio renderer changes, run `pnpm run studio` and the Studio package typecheck.

## Commit & Pull Request Guidelines

Use standard Conventional Commits for every commit: `type(scope): subject`. Allowed types are `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`, and `revert`. Keep the subject concise and imperative; examples: `feat(sync): add relay session config`, `fix(ar): handle missing model assets`, `docs: update Android release steps`.

Pull requests should describe the user-visible change, list verification commands or manual checks, link related issues when available, and include screenshots or recordings for UI/AR workflow changes.

## Security & Configuration Tips

Do not commit generated native folders or build outputs. The repository ignores root `android/` and `ios/`, `apps/mobile/android`, `apps/mobile/ios`, Studio and relay build outputs, and local Gradle cache directories. If generated files are needed for a local build, keep unrelated generated diffs out of the final change.

Keep local network relay addresses, device IPs, signing credentials, keystores, provisioning profiles, and `.env*.local` files out of source control. Android package identifiers and native permissions live in `apps/mobile/app.json`; rerun prebuild after changing native configuration.
