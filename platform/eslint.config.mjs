import { defineConfig, globalIgnores } from 'eslint/config'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    files: ['src/app/(frontend)/layout.tsx'],
    rules: { '@next/next/no-css-tags': 'off' },
  },
  globalIgnores(['.next/**', '.open-next/**', 'public/**', 'cloudflare-env.d.ts', 'src/payload-types.ts', 'src/migrations/**']),
])
