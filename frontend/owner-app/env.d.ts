/**
 * The only environment an app reads.
 *
 * Expo inlines every `EXPO_PUBLIC_*` variable into the bundle at BUILD time, so this is a compile-time
 * constant, not a runtime lookup — and it is why nothing secret may ever be named here. `@types/node`
 * is deliberately absent from an app: a screen has no `fs`, no `Buffer` and no `__dirname`, and the
 * compiler should say so.
 */
declare const process: {
  readonly env: {
    readonly EXPO_PUBLIC_API_URL?: string
    readonly EXPO_PUBLIC_AUTH_URL?: string
    readonly EXPO_PUBLIC_API_PREFIX?: string
    readonly NODE_ENV?: 'development' | 'production' | 'test'
    /**
     * The platform this bundle was built for. Not a variable of ours and not read from `.env`:
     * babel-preset-expo substitutes the literal at build time (`configs/expo.js`, `process.env.EXPO_OS`
     * -> the platform), so `process.env.EXPO_OS === 'android'` is a constant in each bundle and folds
     * away in the other two. O4 uses it to keep the keyless Google Maps SDK off Android (DOS-017).
     */
    readonly EXPO_OS?: 'android' | 'ios' | 'web'
  }
}
