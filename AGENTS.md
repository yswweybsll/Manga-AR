# Repository Guidelines

## Project Structure & Module Organization

Manga AR is an Expo React Native app using TypeScript and `@reactvision/react-viro`. The app entry points are `index.ts` and `App.tsx`. Feature code lives under `src/`: `screens/` for UI flows, `scenes/` for AR placement scenes, `services/` for caching, storage, and sync logic, `api/` for model data access, `types/` for shared TypeScript contracts, and `mock/` for local model fixtures. Static app assets are in `assets/`. `relay-server/` contains the Node WebSocket relay, and `manga-ar-studio/index.html` is the desktop studio page.

## Build, Test, and Development Commands

Install root dependencies with `npm install`; install relay dependencies separately with `cd relay-server && npm install`.

- `npm start`: starts Expo with the development client.
- `npm run android` / `npm run ios`: builds and runs the native app on a device or simulator.
- `npm run web`: starts Expo web preview when supported.
- `npm run prebuild` or `npm run prebuild:android`: regenerates native project files.
- `npm run android:release`: builds the Android release APK after prebuild.
- `cd relay-server && node index.js`: starts the WebSocket relay on `PORT` or `3001`.

## Coding Style & Naming Conventions

Use strict TypeScript for app code. Follow the existing React Native style: functional components, hooks, `StyleSheet.create`, two-space indentation, single quotes, semicolons, and named exports for reusable screens/services. Name React components in `PascalCase`, functions and variables in `camelCase`, and type definitions in `PascalCase`. Keep user-facing Chinese copy consistent with nearby UI text.

## Testing Guidelines

No automated test script is currently defined. Before submitting changes, run TypeScript checks with `npx tsc --noEmit` when dependencies are installed, and manually exercise the affected flow with `npm start` or the relevant native command. For relay changes, test `node relay-server/index.js` and verify `/studio` plus WebSocket session behavior.

## Commit & Pull Request Guidelines

Use standard Conventional Commits for every commit: `type(scope): subject`. Allowed types are `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`, and `revert`. Keep the subject concise and imperative; examples: `feat(sync): add relay session config`, `fix(ar): handle missing model assets`, `docs: update Android release steps`. Pull requests should describe the user-visible change, list verification commands or manual checks, link related issues when available, and include screenshots or recordings for UI/AR workflow changes.

## Security & Configuration Tips

Do not commit generated `android/` or `ios/` directories unless the project policy changes. Keep local network relay addresses, device IPs, and signing credentials out of source control. Update `app.json` for package identifiers, then rerun prebuild before native packaging.
