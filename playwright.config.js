const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  outputDir: '/tmp/omnibioai-launcher-playwright-results',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:4303',
    browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'BROWSER=none PORT=4303 npm start',
    url: 'http://127.0.0.1:4303',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
