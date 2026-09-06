import tseslint from 'typescript-eslint'

import base from './base.js'

/**
 * The flat config every Distribution OS APP uses (docs/08 §0, docs/22 §8 2026-09-06).
 *
 * An app is one Expo codebase that ships as website + Android + iOS. That only holds if a screen is
 * written against the `@dos/ui` contract and never against a renderer, so the two rules below are the
 * mechanism, not advice:
 *
 * 1. `react-native` and `react-dom` are unimportable. A screen that reaches for `<View>` or a DOM
 *    node has just forked itself into two files; the kit is where that difference is paid for, once.
 *    Platform behaviour (camera, GPS, print, files, storage) goes through `@dos/ui/platform`, whose
 *    `.web.ts` / `.native.ts` pairs share one signature.
 * 2. A raw hex colour is unwritable. Every colour is a semantic token from `@dos/ui` (`useColors()`),
 *    which is what keeps the contrast ratios of UX-00 §3 true and the white-label rule honest —
 *    a distributor supplies a name and a logo, never a palette.
 *
 * Libraries under `frontend/libs/ui` use `@dos/config/eslint/base` instead: the kit is the ONE place
 * allowed to import a renderer and to name a colour.
 */
const RENDERER_MESSAGE =
  'A screen is written against the @dos/ui contract, never a renderer (docs/08 §0). Use the kit components and layout primitives (Screen, Box, Stack, Row, Scroll, List, Pressable, Img, Link, Txt); platform behaviour goes through @dos/ui/platform.'

const HEX_MESSAGE =
  'No hex colour outside the token file (UX-00 §16). Read a semantic colour from the theme: `const colors = useColors()`, then `colors.text.primary` / `colors.status.brick.fg`.'

export default [
  ...base,
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react-native', message: RENDERER_MESSAGE },
            { name: 'react-native-web', message: RENDERER_MESSAGE },
            { name: 'react-dom', message: RENDERER_MESSAGE },
            { name: 'react-dom/client', message: RENDERER_MESSAGE },
            { name: 'react-dom/server', message: RENDERER_MESSAGE },
            { name: 'react-native-svg', message: RENDERER_MESSAGE },
            {
              name: '@dos/ui/web',
              message:
                'Import from "@dos/ui": Metro picks the renderer per platform. Naming @dos/ui/web pins the app to the browser.',
            },
            {
              name: '@dos/ui/native',
              message:
                'Import from "@dos/ui": Metro picks the renderer per platform. Naming @dos/ui/native pins the app to the phone.',
            },
          ],
          patterns: [
            { group: ['react-native/*'], message: RENDERER_MESSAGE },
            { group: ['react-dom/*'], message: RENDERER_MESSAGE },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
          message: HEX_MESSAGE,
        },
        {
          selector:
            'TemplateElement[value.raw=/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/]',
          message: HEX_MESSAGE,
        },
      ],
    },
  },
  {
    /**
     * Metro's config, Babel's config and the generator script are Node files, not screens: they run
     * in the toolchain, they are CommonJS or plain ESM, and they are outside the app's `tsconfig`.
     * Type-aware linting has nothing to work with there and reports every expression as `any`, so
     * this block turns the type-aware rules off for those files and declares the Node globals — it
     * does NOT relax anything that applies to a screen.
     */
    files: ['**/*.js', '**/*.mjs', '**/*.cjs', 'scripts/**'],
    languageOptions: {
      parserOptions: { projectService: false, project: false, program: null },
      globals: {
        module: 'writable',
        require: 'readonly',
        exports: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      // Every rule that needs a type checker, switched off in one place rather than named one by one.
      ...tseslint.configs.disableTypeChecked.rules,
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]
