import { defineConfig, devices } from '@playwright/test';

/**
 * OpenMake LLM E2E 테스트 설정
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',

    use: {
        baseURL: 'http://localhost:3001',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
        },
    ],

    /* 로컬 개발 서버 자동 시작 */
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:3001',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
    },
});
