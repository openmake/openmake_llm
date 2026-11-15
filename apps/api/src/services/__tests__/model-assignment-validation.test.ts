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
const keysRepo = { getByUserAndProvider: jest.fn(), decryptKey: jest.fn() };
jest.mock('../../data/repositories/external-keys-repo', () => ({
    ExternalKeysRepository: jest.fn().mockImplementation(() => keysRepo),
}));

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

describe('validateModelAssignment — 외부 키 켜짐 여부', () => {
    beforeEach(() => { keysRepo.getByUserAndProvider.mockReset(); keysRepo.decryptKey.mockReset(); });

    it('꺼진 키 → "꺼져 있습니다" 로 거부, 복호화·실호출하지 않는다', async () => {
        keysRepo.getByUserAndProvider.mockResolvedValue({ isActive: true, enabled: false, authMethod: 'api_key', baseUrl: null });
        expect(await validateModelAssignment('3', 'gemini:gemini-x')).toBe("'gemini' API 키가 꺼져 있습니다");
        expect(keysRepo.getByUserAndProvider).toHaveBeenCalledWith('3', 'gemini', { includeDisabled: true });
        expect(keysRepo.decryptKey).not.toHaveBeenCalled();
    });

    it('미등록 키 → 종전 문구', async () => {
        keysRepo.getByUserAndProvider.mockResolvedValue(null);
        expect(await validateModelAssignment('3', 'gemini:gemini-x')).toBe("'gemini' API 키를 먼저 등록하세요");
    });
});
