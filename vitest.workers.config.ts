import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [cloudflareTest(async () => ({
    wrangler: { configPath: './workers/jobs/wrangler.jsonc' },
    miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations('./migrations') } },
  }))],
  test: { include: ['tests/workers/**/*.test.ts'] },
})
