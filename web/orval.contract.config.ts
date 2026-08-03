import { defineConfig } from 'orval'

export default defineConfig({
  openappsContract: {
    input: '../packages/contracts/openapi.json',
    output: {
      target: './src/api/contract/openapps.ts',
      schemas: './src/api/contract/models',
      client: 'react-query',
      httpClient: 'axios',
      mode: 'single',
      clean: true,
      override: {
        mutator: {
          path: './src/lib/orval-mutator.ts',
          name: 'orvalMutator',
        },
      },
    },
  },
})
