import { defineConfig, devices } from '@playwright/test'

// Le E2E girano sulla vetrina unita come su Pages (`wrangler pages dev`), col KV locale scritto dal motore.
export default defineConfig({
  testDir: 'sito/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:8788',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 15'] }, testIgnore: /soci\.spec\.ts/ },
    { name: 'android', use: { ...devices['Pixel 7'] }, testIgnore: /soci\.spec\.ts/ },
    // I numeri dei soci cambiano nel KV locale durante la prova: gira da sola, dopo le altre, che li leggono.
    { name: 'soci', use: { ...devices['Pixel 7'] }, testMatch: /soci\.spec\.ts/, dependencies: ['iphone', 'android'] },
  ],
  webServer: {
    command: 'npm run seed:local -w motore && npm run build -w sito && npm run preview -w sito',
    url: 'http://localhost:8788',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
