# Distribution OS - Owner (`@dos/owner-app`)

One Expo codebase: website + Android + iOS (docs/08 §0). Generated from `@dos/app-template`.

```bash
cd backend  && pnpm --filter @dos/auth-service dev            # :3000, sign-in
cd backend  && pnpm --filter @dos/owner-service dev          # :3001
cd frontend && pnpm --filter @dos/owner-app web              # http://localhost:5173
cd frontend && pnpm --filter @dos/owner-app ios              # the iOS simulator
cd frontend && pnpm --filter @dos/owner-app android          # a connected device or emulator
```

Screens are written against the `@dos/ui` contract only; `react-native` and `react-dom` are
unimportable here (ESLint). Platform behaviour goes through `@dos/ui/platform`.
