/**
 * OpenMake LLM E2E 테스트
 * 주요 사용자 플로우 테스트
 */

import { test, expect } from '@playwright/test';

test.describe('API 헬스체크', () => {
    test('서버 상태 확인 (GET /health)', async ({ request }) => {
        const response = await request.get('/health');
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.status).toBe('ok');
    });

    test('준비 상태 확인 (GET /ready)', async ({ request }) => {
        const response = await request.get('/ready');
        expect(response.status()).toBe(200);
    });
});

test.describe('API 문서', () => {
    test('Swagger UI 접근 가능 (GET /api-docs)', async ({ page }) => {
        await page.goto('/api-docs');
        await expect(page.locator('#swagger-ui')).toBeVisible();
    });

    test('OpenAPI 스펙 조회 (GET /api/openapi.json)', async ({ request }) => {
        const response = await request.get('/api/openapi.json');
        expect(response.status()).toBe(200);

        const spec = await response.json();
        expect(spec.openapi).toMatch(/^3\./);
        expect(spec.info.title).toBeTruthy();
    });
});

test.describe('에이전트 API', () => {
    test('에이전트 목록 조회 (GET /api/agents)', async ({ request }) => {
        const response = await request.get('/api/agents');
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.agents).toBeDefined();
        expect(Array.isArray(body.agents)).toBe(true);
        expect(body.total).toBeGreaterThan(0);
    });

    test('에이전트 메트릭 조회 (GET /api/agents/metrics)', async ({ request }) => {
        const response = await request.get('/api/agents/metrics');
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.metrics).toBeDefined();
    });
});

test.describe('클러스터 API', () => {
    test('클러스터 상태 조회 (GET /api/cluster/status)', async ({ request }) => {
        const response = await request.get('/api/cluster/status');
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.nodes).toBeDefined();
    });
});

test.describe('MCP API', () => {
    test('MCP 설정 조회 (GET /api/mcp/settings)', async ({ request }) => {
        const response = await request.get('/api/mcp/settings');
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.settings).toBeDefined();
    });

    test('MCP 도구 목록 조회 (GET /api/mcp/tools)', async ({ request }) => {
        const response = await request.get('/api/mcp/tools');
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.tools).toBeDefined();
    });
});

test.describe('메인 페이지 UI', () => {
    test('홈페이지 로드', async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveTitle(/OpenMake|AI|LLM/i);
    });

    test('채팅 인터페이스 존재 확인', async ({ page }) => {
        await page.goto('/');

        // 채팅 입력 영역 존재 확인 (다양한 선택자 시도)
        const chatInput = page.locator('textarea, input[type="text"], [contenteditable="true"]').first();
        await expect(chatInput).toBeVisible({ timeout: 10000 });
    });
});

test.describe('시스템 API', () => {
    test('사용량 통계 조회 (GET /api/usage)', async ({ request }) => {
        const response = await request.get('/api/usage');
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.success).toBe(true);
    });

    test('모델 정보 조회 (GET /api/model)', async ({ request }) => {
        const response = await request.get('/api/model');
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.model).toBeDefined();
    });
});
