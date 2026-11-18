import { defineConfig, devices } from '@playwright/test';

const PORT = 5335;

/**
 * Two-person messenger and video-call test against the real server
 * (server/app.mjs) serving the production build, with an in-memory database.
 * Chromium's fake camera and microphone stand in for real devices.
 *
 *   npm run build && npm run test:messenger
 */
export default defineConfig({
  testDir: './e2e-messenger',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'retain-on-failure',
    permissions: ['camera', 'microphone'],
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ../server/app.mjs',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PORT: String(PORT), DATABASE_PATH: ':memory:' },
  },
});
