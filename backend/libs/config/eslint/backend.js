import boundaries from 'eslint-plugin-boundaries'
import base from './base.js'

/**
 * Backend config: base rules + module boundaries for the modular monolith.
 * A module under src/modules/<name>/ may only import another module through its public
 * barrel (src/modules/<other>/index.ts), never its internals.
 */
export default [
  ...base,
  {
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'module', pattern: 'src/modules/*', mode: 'folder', capture: ['name'] },
        { type: 'platform', pattern: 'src/platform/*', mode: 'folder' },
      ],
      'boundaries/ignore': ['**/*.spec.ts', '**/*.test.ts'],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'allow',
          rules: [
            // modules may depend on the platform layer and on other modules (through their index only)
            { from: ['module'], allow: ['platform', 'module'] },
            { from: ['platform'], disallow: ['module'] },
          ],
        },
      ],
      'boundaries/entry-point': [
        'error',
        {
          default: 'disallow',
          rules: [
            { target: ['module'], allow: 'index.ts' },
            { target: ['platform'], allow: '*.ts' },
          ],
        },
      ],
    },
  },
]
