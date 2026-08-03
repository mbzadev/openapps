import { defineConfig } from 'orval'

export default defineConfig({
  openapps: {
    input: '../packages/contracts/openapi.json',
    output: {
      target: './src/api/endpoints',
      schemas: './src/api/models',
      client: 'react-query',
      httpClient: 'axios',
      mode: 'tags-split',
      override: {
        mutator: {
          path: './src/lib/orval-mutator.ts',
          name: 'orvalMutator',
        },
      },
    },
  },
})
