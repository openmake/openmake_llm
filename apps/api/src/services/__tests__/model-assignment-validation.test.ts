/**
 * model-assignment-validation — 로컬 태그 검증 오류 메시지 상한.
 * 게이트웨이 /v1/models 엔 외부 `provider/model` 항목이 수백 개 섞여 있어
 * 전부 실으면 400 본문이 수십 KB 가 되던 결함(2026-09-16) 회귀 방지.
 */
const listModels = jest.fn();

jest.mock('../../llm', () => ({
    createClient: () => ({ listModels }),
}));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));

import { validateModelAssignment } from '../model-assignment-validation';

describe('validateModelAssignment — 로컬 태그', () => {
    beforeEach(() => listModels.mockReset());

    it('없는 로컬 태그: 외부 provider/model 항목은 빼고 로컬 태그만 상한(10)까지 안내', async () => {
        const local = Array.from({ length: 12 }, (_, i) => ({ name: `local-${i}` }));
        const external = Array.from({ length: 300 }, (_, i) => ({ name: `openrouter/vendor/model-${i}` }));
        listModels.mockResolvedValue({ models: [...local, ...external, { name: 'nvidia/*' }] });

        const reason = await validateModelAssignment('3', 'local-llm:nope');
        expect(reason).toContain("'nope'");
        expect(reason).toContain('local-0');
        expect(reason).toContain('local-9');
        expect(reason).not.toContain('local-10');
        expect(reason).toContain('외 2개');
        expect(reason).not.toContain('openrouter/');
        expect(reason!.length).toBeLessThan(400);
    });

    it('존재하는 로컬 태그는 통과', async () => {
        listModels.mockResolvedValue({ models: [{ name: 'qwen3.8-27b' }, { name: 'bai/*' }] });
        expect(await validateModelAssignment('3', 'local-llm:qwen3.8-27b')).toBeNull();
    });

    it('LLM 서버 무응답이면 fail-open', async () => {
        listModels.mockRejectedValue(new Error('ECONNREFUSED'));
        expect(await validateModelAssignment('3', 'local-llm:anything')).toBeNull();
    });
});
