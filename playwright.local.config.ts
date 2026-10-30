import { defineConfig, devices } from '@playwright/test'
import { local } from './tests/support/local'

/**
 * Full sign-in journeys against the LOCAL Supabase stack (`npx supabase start`).
 * ONIC_E2E_API_URL lets a machine route API calls through a local proxy; CI uses the stack directly.
 */
const api = process.env['ONIC_E2E_API_URL'] ?? local.url

export default defineConfig({
  testDir: 'tests/e2e-local',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/local',
  use: { baseURL: 'http://localhost:4174', ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 },
    launchOptions: process.env['PW_CHROMIUM_PATH'] ? { executablePath: process.env['PW_CHROMIUM_PATH'] } : {} },
  webServer: {
    command: 'npm run build -w @onic/web && npm run preview -w @onic/web -- --port 4174',
    url: 'http://localhost:4174',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: api,
      VITE_SUPABASE_PUBLISHABLE_KEY: local.publishable,
      ONIC_E2E_SUPABASE_URL: api,
    },
  },
})
