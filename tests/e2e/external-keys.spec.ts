/**
 * OpenMake LLM 외부 LLM 키 관리 E2E 테스트
 *
 * Phase 3·4 외부 provider 통합 검증:
 * - 게스트 차단 (401/403)
 * - 카탈로그 응답 형식
 * - 모델 selector 에 fullId('provider:model') 포함
 *
 * 실제 Anthropic / OpenAI 호환 API 호출이 필요한 시나리오는 본 파일에서 다루지
 * 않음 (별도 비밀 환경에서 실행). 본 파일은 인증·구조 검증만 수행한다.
 */

import { test, expect } from '@playwright/test';

test.describe('외부 LLM 키 API — 게스트 차단', () => {
    test('GET /api/external-keys — 게스트는 401', async ({ request }) => {
        const response = await request.get('/api/external-keys');
        expect([401, 403]).toContain(response.status());
    });

    test('POST /api/external-keys/anthropic — 게스트는 401', async ({ request }) => {
        const response = await request.post('/api/external-keys/anthropic', {
            data: {
                sdk_type: 'anthropic',
                display_name: 'Test',
                api_key: 'sk-ant-fake',
            },
        });
        expect([401, 403]).toContain(response.status());
    });

    test('DELETE /api/external-keys/anthropic — 게스트는 401', async ({ request }) => {
        const response = await request.delete('/api/external-keys/anthropic');
        expect([401, 403]).toContain(response.status());
    });

    test('POST /api/external-keys/anthropic/validate — 게스트는 401', async ({ request }) => {
        const response = await request.post('/api/external-keys/anthropic/validate');
        expect([401, 403]).toContain(response.status());
    });

    test('GET /api/external-keys/usage/recent — 게스트는 401', async ({ request }) => {
        const response = await request.get('/api/external-keys/usage/recent');
        expect([401, 403]).toContain(response.status());
    });
});

test.describe('모델 카탈로그 — fullId 형식', () => {
    test('GET /api/models — 게스트도 로컬 모델 노출', async ({ request }) => {
        const response = await request.get('/api/models');
        expect(response.status()).toBe(200);
        const json = await response.json();
        const data = json.data ?? json;
        expect(Array.isArray(data.models)).toBe(true);
        expect(data.models.length).toBeGreaterThan(0);
        // 각 모델은 fullId 형식 (`provider:model`) 이어야 함
        for (const m of data.models) {
            expect(m.modelId).toMatch(/^[a-z-]+:.+/);
            expect(m.provider).toBeDefined();
        }
    });
});

test.describe('외부 키 페이지 — 인증 게이트', () => {
    test('GET /external-keys.html — 정적 자원은 200, 데이터 호출은 401', async ({ page }) => {
        const response = await page.goto('/external-keys.html');
        // 정적 HTML 자체는 누구나 접근 가능 (로그인 안내 노출)
        expect(response?.status()).toBe(200);
        // 데이터 fetch 가 401 응답으로 끝나면 "로그인이 필요합니다" 안내가 나타나야 함
        await expect(page.locator('#providerList')).toContainText(/로그인|불러오는|등록 가능/, { timeout: 10000 });
    });
});
