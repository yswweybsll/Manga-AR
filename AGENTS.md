# Repository Guidelines

## Project Structure & Module Organization

Manga AR is a pnpm workspace monorepo. `apps/mobile` contains the Expo React Native app using TypeScript and `@reactvision/react-viro`; its entry points are `apps/mobile/index.ts` and `apps/mobile/App.tsx`. `apps/relay` contains the Node WebSocket relay. `apps/studio-desktop` contains the Electron desktop Studio skeleton and the migrated static prototype under `apps/studio-desktop/prototype`. `shared` contains platform-neutral TypeScript contracts consumed by mobile, relay, and desktop.

## Build, Test, and Development Commands

- `pnpm install`: installs all workspace dependencies from the repository root.
- `pnpm start`: starts the Expo mobile app through the root forwarding script.
- `pnpm --filter @manga-ar/mobile start`: starts Expo directly from the mobile workspace.
- `pnpm run android` / `pnpm run ios`: builds and runs the native mobile app on a device or simulator.
- `pnpm run relay`: starts the WebSocket relay on `PORT` or `3001`.
- `pnpm run studio`: starts the desktop Studio renderer dev server.
- `pnpm run typecheck`: runs TypeScript checks for shared, mobile, relay, and desktop.
- `pnpm run check:structure`: verifies the workspace dependency boundaries.

## Coding Style & Naming Conventions

Use strict TypeScript for app code. Follow the existing React Native style: functional components, hooks, `StyleSheet.create`, two-space indentation, single quotes, semicolons, and named exports for reusable screens/services. Name React components in `PascalCase`, functions and variables in `camelCase`, and type definitions in `PascalCase`. Keep user-facing Chinese copy consistent with nearby UI text.

## Testing Guidelines

Before submitting structural changes, run `pnpm run check:structure` and `pnpm run typecheck`. For mobile changes, also manually exercise the affected flow with `pnpm start` or the relevant native command. For relay changes, test `pnpm run relay` and verify `/studio` plus WebSocket session behavior.

## Commit & Pull Request Guidelines

Use standard Conventional Commits for every commit: `type(scope): subject`. Allowed types are `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`, and `revert`. Keep the subject concise and imperative; examples: `feat(sync): add relay session config`, `fix(ar): handle missing model assets`, `docs: update Android release steps`. Pull requests should describe the user-visible change, list verification commands or manual checks, link related issues when available, and include screenshots or recordings for UI/AR workflow changes.

## Security & Configuration Tips

Do not commit generated `android/` or `ios/` directories unless the project policy changes. Keep local network relay addresses, device IPs, and signing credentials out of source control. Update `app.json` for package identifiers, then rerun prebuild before native packaging.
