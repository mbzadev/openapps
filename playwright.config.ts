import { defineConfig, devices } from '@playwright/test'

const hostIp = process.env.OPENAPPS_E2E_HOST_IP
const baseURL = process.env.OPENAPPS_E2E_URL ?? 'https://apps.mbza.dev'
const hostname = new URL(baseURL).hostname

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      launchOptions: { args: ['--disable-quic', ...(hostIp ? [`--host-resolver-rules=MAP ${hostname} ${hostIp},EXCLUDE localhost`] : [])] },
    },
  }],
})
