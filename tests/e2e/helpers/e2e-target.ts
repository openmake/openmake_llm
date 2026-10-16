/**
 * e2e 대상 API URL 의 단일 출처 — playwright.config.ts 의 use.baseURL 과 helper 가 같은 규칙을 쓴다.
 * E2E_BASE_URL → PW_TEST_BASE_URL(하위호환) → http://localhost:52418(로컬 개발 API).
 * 호출 시점에 읽는다 — config 가 tests/e2e/.env.e2e 를 dotenv 로 읽은 뒤에 불러야 그 값이 반영된다.
 */
const DEFAULT_E2E_BASE_URL = 'http://localhost:52418';

export function e2eBaseUrl(): string {
    return process.env.E2E_BASE_URL || process.env.PW_TEST_BASE_URL || DEFAULT_E2E_BASE_URL;
}
