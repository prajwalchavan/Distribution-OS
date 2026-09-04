// Expo's flat config (eslint-config-expo). The shared @dos/config base is type-aware and tuned for Node
// packages; the mobile apps use Expo's rules plus prettier.
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')

module.exports = defineConfig([expoConfig, { ignores: ['dist/*', '.expo/*', 'expo-env.d.ts'] }])
