/**
 * message-pipeline ↔ 오케스트레이터 배선 — 턴 출처 번호 기준 전달·밀기와 스트림 ctx 필드.
 *
 * 각 단계(orchestratorStreamFields·appendDeterministicBlocks)는 단위 테스트가 있지만, 파이프라인이 기준을 넘기지 않거나
 * 번호표 원문(sourceContextText)을 싣지 않으면 오케스트레이터 검색만 돈 턴에서 블록 안 `[출처 N]` 줄이 사전 주입으로 읽힌다.
 * 그래서 파이프라인을 실제로 돌리고, 바깥 의존성(DB·LLM·에이전트 라우팅)만 가짜로 둔다.
 */
const runOrchestrator = jest.fn();
jest.mock('../../orchestrator/orchestrate', () => ({
    ...jest.requireActual('../../orchestrator/orchestrate'),
    runOrchestrator: (...args: unknown[]) => runOrchestrator(...args),
}));
jest.mock('../../addon/addon-state', () => ({ ensureAddonStates: async () => undefined }));
jest.mock('../provider-gate', () => ({
    runProviderGate: async () => ({ providerId: 'gemini', modelId: 'gemini-2.5-flash', fullId: 'gemini:gemini-2.5-flash' }),
    servedModelLabel: (r: { fullId: string }) => r.fullId,
}));
jest.mock('../memory-policy', () => ({ resolveMemoryLearning: async () => false }));
jest.mock('../user-context-blocks', () => ({ buildUserContextBlocks: async () => ({ memoryBlock: '', customInstructionsBlock: '' }) }));
jest.mock('../artifact-guide-block', () => ({ buildArtifactGuideBlock: async () => '' }));
jest.mock('../turn-integrations', () => ({
    ...jest.requireActual('../turn-integrations'),
    getActiveChatTurnIntegrations: () => [],
    isSessionMemoryIsolated: async () => true,
}));

import { runMessagePipeline } from '../message-pipeline';
import { ORCHESTRATOR } from '../../../config/capabilities';
import type { StreamFromExternalContext } from '../external-provider-types';
import type { RequestContext } from '../request-context';

const PRE_INJECTED = '질문\n\n[출처 1] 사전 1\n   URL: https://pre.example/1';
const BLOCK = '[오케스트레이터 작업 결과 — …]\n\n### t1 · web.search\n[출처 11] 날씨\n   URL: https://orch.example/11';
const orchSources = [[{ n: 11, title: '날씨', url: 'https://orch.example/11', snippet: '' }, { n: 12, title: '날씨 2', url: 'https://orch.example/12', snippet: '' }]];

function fakeService(captured: { ctx?: StreamFromExternalContext; reqCtx?: RequestContext }) {
    return {
        providerRouter: {},
        client: { model: 'local-default' },
        buildUserContext: (userId: string) => ({ userId, role: 'user', tier: 'free' }),
        resolveLanguagePolicy: () => ({ resolvedLanguage: 'ko' }),
        resolveAgent: async () => ({ agentSelection: { primaryAgent: 'general' }, agentSystemMessage: '', selectedAgent: { id: 'general' } }),
        buildContextForLLM: async () => ({ finalEnhancedMessage: PRE_INJECTED }),
        loadSkillBindings: async () => undefined,
        streamFromExternalProvider: async (_r: unknown, _req: unknown, _onToken: unknown, ctx: StreamFromExternalContext, reqCtx: RequestContext) => {
            captured.ctx = ctx;
            captured.reqCtx = reqCtx;
            return '맑음';
        },
        setDelegatedTasks: () => undefined,
        recordMetricsAndVerify: () => undefined,
    } as never;
}

describe('runMessagePipeline — 오케스트레이터 출처 배선', () => {
    const enabled = ORCHESTRATOR.ENABLED;
    beforeAll(() => { (ORCHESTRATOR as { ENABLED: boolean }).ENABLED = true; });
    afterAll(() => { (ORCHESTRATOR as { ENABLED: boolean }).ENABLED = enabled; });
    beforeEach(() => runOrchestrator.mockReset());

    it('턴 번호 기준을 넘기고, 출처 수만큼 민 기준·출처·블록 앞 번호표 원문을 스트림에 싣는다', async () => {
        runOrchestrator.mockResolvedValue({ mode: 'executed', contextBlock: BLOCK, mediaMarkdowns: [], sources: orchSources, plannerMs: 1, execMs: 1 });
        const captured: { ctx?: StreamFromExternalContext; reqCtx?: RequestContext } = {};

        await runMessagePipeline(fakeService(captured), { message: '서울 날씨', userId: 'u1', userRole: 'user', sourceNumberBase: 10 } as never, () => undefined);

        expect(runOrchestrator.mock.calls[0][0]).toEqual(expect.objectContaining({ sourceNumberBase: 10 }));
        expect(captured.ctx).toEqual(expect.objectContaining({ orchestratorSources: orchSources, orchestratorBlockInjected: true, sourceContextText: PRE_INJECTED }));
        expect(captured.ctx!.enhancedMessage).toContain(BLOCK);
        expect(captured.reqCtx!.userContext.sourceNumberBase).toBe(12);
    });

    it('블록이 없는 턴은 출처·주입 표시 없이 번호표 원문만 싣는다(종전 enhancedMessage 와 같은 값)', async () => {
        runOrchestrator.mockResolvedValue({ mode: 'simple', mediaMarkdowns: [], plannerMs: 1 });
        const captured: { ctx?: StreamFromExternalContext; reqCtx?: RequestContext } = {};

        await runMessagePipeline(fakeService(captured), { message: '서울 날씨', userId: 'u1', userRole: 'user', sourceNumberBase: 10 } as never, () => undefined);

        expect(captured.ctx!.orchestratorSources).toBeUndefined();
        expect(captured.ctx!.orchestratorBlockInjected).toBeUndefined();
        expect(captured.ctx!.sourceContextText).toBe(captured.ctx!.enhancedMessage);
        expect(captured.reqCtx!.userContext.sourceNumberBase).toBe(10);
    });
});
