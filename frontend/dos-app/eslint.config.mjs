import app from '@dos/config/eslint/app'

export default [...app, { ignores: ['dist/**', '.expo/**', 'expo-env.d.ts', 'env.d.ts'] }]
