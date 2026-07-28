/**
 * OpenMake LLM API 라우트 E2E 테스트
 * 인증 없이 접근 가능한 공개 엔드포인트 검증
 */

import { test, expect } from '@playwright/test';

test.describe('메모리 API', () => {
    test('메모리 목록 조회 — 인증 없으면 401 반환', async ({ request }) => {
        const response = await request.get('/api/memories');
        expect([401, 403]).toContain(response.status());
    });
});

test.describe('문서 API', () => {
    test('문서 목록 조회 — 인증 없으면 401/403 반환', async ({ request }) => {
        const response = await request.get('/api/documents');
        expect([401, 403]).toContain(response.status());
    });
});

test.describe('감사 로그 API', () => {
    test('감사 로그 조회 — 인증 없으면 401/403 반환', async ({ request }) => {
        const response = await request.get('/api/audit');
        expect([401, 403]).toContain(response.status());
    });
});

test.describe('지식베이스 API', () => {
    test('KB 목록 조회 — 인증 없으면 401/403 반환', async ({ request }) => {
        const response = await request.get('/api/kb');
        expect([401, 403]).toContain(response.status());
    });
});

test.describe('메트릭 API', () => {
    test('메트릭 엔드포인트 — 인증 없으면 401/403 반환', async ({ request }) => {
        const response = await request.get('/api/metrics');
        expect([401, 403]).toContain(response.status());
    });
});

test.describe('RAG API', () => {
    test('RAG 상태 조회 — 인증 없으면 401/403 반환', async ({ request }) => {
        const response = await request.get('/api/rag/status');
        expect([401, 403, 404]).toContain(response.status());
    });
});

test.describe('노드 API', () => {
    test('노드 목록 조회 (GET /api/nodes)', async ({ request }) => {
        const response = await request.get('/api/nodes');
        // 노드 목록은 공개 또는 인증 필요
        expect([200, 401, 403]).toContain(response.status());
    });
});

test.describe('OpenAI 호환 API', () => {
    test('모델 목록 조회 (GET /api/v1/models)', async ({ request }) => {
        const response = await request.get('/api/v1/models');
        expect([200, 401, 403]).toContain(response.status());
    });
});

test.describe('존재하지 않는 라우트', () => {
    test('없는 API 경로 → 404 반환', async ({ request }) => {
        const response = await request.get('/api/nonexistent-route-12345');
        expect(response.status()).toBe(404);
    });
});
