/** 계획 실패 안내가 일반 텍스트 답변을 오염시키지 않되 미디어 미실행 사실은 보존한다. */
jest.mock('../planner', () => ({ planRequest: jest.fn() }));
jest.mock('../media-gate', () => ({
    runMediaGateShadow: async () => undefined,
    runSearchGateShadow: async () => undefined,
    shouldSkipPlanner: () => false,
    gatesWithin: async () => [undefined, undefined],
}));
jest.mock('../../../config/capabilities', () => ({
    ...jest.requireActual('../../../config/capabilities'),
    ORCHESTRATOR: { ...jest.requireActual('../../../config/capabilities').ORCHESTRATOR, SHADOW_ENABLED: false },
}));

import { planRequest } from '../planner';
import { runOrchestrator } from '../orchestrate';

describe('계획 실패 안내', () => {
    beforeEach(() => {
        jest.mocked(planRequest).mockResolvedValue({ plan: null, registryRevision: 0, schemaHash: '', attempts: 1, error: 'timeout 15000ms', ms: 15000, model: 'gemini:test' });
    });

    it.each([
        ['en', 'Reply exactly: 17+25=42.', /For requests that can be answered in text, answer normally without mentioning planning or media failures\./],
        ['ko', '17+25=42만 답하세요.', /텍스트로 답할 수 있는 요청에는 계획 실패나 미디어 미실행을 언급하지 말고 정상적으로 답하세요/],
    ])('%s 일반 요청의 답변에 불필요한 실패 설명을 요구하지 않는다', async (lang, message, instruction) => {
        const result = await runOrchestrator({ req: { message }, lang });
        expect(result.mode).toBe('fallback');
        expect(result.contextBlock).toMatch(instruction);
        expect(result.mediaMarkdowns).toEqual([]);
    });

    it.each([
        ['en', 'Draw a cat.', /Only if the user requested media generation/],
        ['ko', '고양이 그림을 만들어 주세요.', /사용자가 미디어 생성을 요청한 경우에만/],
    ])('%s 미디어 요청에는 미실행 사실과 사유를 알리도록 유지한다', async (lang, message, instruction) => {
        const result = await runOrchestrator({ req: { message }, lang });
        expect(result.contextBlock).toMatch(instruction);
        expect(result.contextBlock).toContain('timeout 15000ms');
        expect(result.mediaMarkdowns).toEqual([]);
    });

    it('취소된 계획은 실패 안내 없이 종료한다', async () => {
        jest.mocked(planRequest).mockResolvedValue({ plan: null, registryRevision: 0, schemaHash: '', attempts: 1, error: 'cancelled', ms: 1, model: 'gemini:test' });
        const result = await runOrchestrator({ req: { message: 'cancel' }, lang: 'en' });
        expect(result.mode).toBe('cancelled');
        expect(result.contextBlock).toBeUndefined();
    });
});
