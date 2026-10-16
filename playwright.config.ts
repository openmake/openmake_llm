/**
 * Playwright config — tests/e2e/ 의 *.spec.ts 를 chromium + webkit 으로 실행.
 *
 * 대상은 로컬 API 만 기본으로 둔다(운영 포트 기본값 없음). 로컬 실행:
 *   cp tests/e2e/.env.e2e.example tests/e2e/.env.e2e      # 한 번 — 로컬 주소만 넣는다
 *   npm run test:e2e -- --project=chromium
 *
 * 환경변수(셸 또는 tests/e2e/.env.e2e — 셸이 우선한다):
 *   E2E_BASE_URL      — 대상 API URL. 없으면 PW_TEST_BASE_URL(하위호환), 그것도 없으면 http://localhost:52418(로컬 개발 API).
 *   E2E_WS_ORIGIN     — WS 연결의 Origin 헤더(plugin-boundary.spec.ts). 기본 http://localhost:3010.
 *   TEST_DATABASE_URL — DB 픽스처(사용자 정리·관리자 승격·상태 조작). 이름이 _test 로 끝나야 하고, DATABASE_URL 로 대체하지 않는다.
 * 루트 .env 는 읽지 않는다 — e2e 가 운영·개발 DB 자격증명을 우연히 집지 않게 한다.
 */
import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config({ path: `${__dirname}/tests/e2e/.env.e2e`, quiet: true });

const baseURL = process.env.E2E_BASE_URL || process.env.PW_TEST_BASE_URL || 'http://localhost:52418';

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
        baseURL,
        trace: 'retain-on-failure',
        actionTimeout: 5_000,
        navigationTimeout: 10_000,
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
    ],
});
