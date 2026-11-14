import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    permissions: ['microphone'],
    trace: 'retain-on-failure',
    launchOptions: { args: [
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      '--use-file-for-fake-audio-capture=' + resolve('.browser-fixtures/speech.wav'),
    ] },
  },
  webServer: {
    command: (process.env.CI ? 'python' : '../.venv/bin/python') + ' ../scripts-browser-server.py',
    url: 'http://127.0.0.1:4173/health/ready',
    reuseExistingServer: false,
    timeout: 60_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
})
