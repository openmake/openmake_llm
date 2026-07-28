/**
 * Playwright config — tests/e2e/ 의 *.spec.ts 를 chromium + webkit 으로 실행.
 *
 * 로컬 실행:
 *   PORT=52417 npm run dev:api   # (별 터미널) 백엔드 dev 서버
 *   PW_TEST_BASE_URL=http://localhost:52417 npm run test:e2e
 *
 * 환경변수:
 *   PW_TEST_BASE_URL — 서버 URL (기본: http://localhost:52416, prod 서버와 동일)
 *   DATABASE_URL     — DB 픽스처용. 아래 dotenv 로 루트 .env 에서 로드한다.
 */
import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

// DB 자격증명을 spec 에 하드코딩하지 않기 위해 루트 .env 를 선로드한다(공개 리포).
dotenv.config({ path: `${__dirname}/.env`, quiet: true });

export default defineConfig({
    testDir: 'tests/e2e',
    testMatch: '**/*.spec.ts',
    timeout: 30_000,
    expect: { timeout: 5_000 },
    fullyParallel: true,
    retries: 0,
    workers: 1,  // 인증 race condition 회피 — DB 동일 인스턴스 공유
    reporter: [['list']],
    use: {
        baseURL: process.env.PW_TEST_BASE_URL || 'http://localhost:52416',
        trace: 'retain-on-failure',
        actionTimeout: 5_000,
        navigationTimeout: 10_000,
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
    ],
});
