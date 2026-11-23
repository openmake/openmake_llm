/**
 * message-pipeline ↔ 반출 관문(하네스 P0-2) — 민감 자료 턴은 외부 모델을 내부 모델로 바꾸고, 오케스트레이터·외부 모드를
 * 건너뛰고, 도구 실행 문맥에 내부 전용 표시를 싣는다. 바깥 의존성(DB·LLM·에이전트 라우팅)만 가짜로 둔다.
 */
const runOrchestrator = jest.fn();
jest.mock('../../orchestrator/orchestrate', () => ({
    ...jest.requireActual('../../orchestrator/orchestrate'),
    runOrchestrator: (...args: unknown[]) => runOrchestrator(...args),
}));
jest.mock('../../addon/addon-state', () => ({ ensureAddonStates: async () => undefined }));
const gate = jest.fn();
jest.mock('../provider-gate', () => ({
    runProviderGate: (...a: unknown[]) => gate(...a),
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
const logAudit = jest.fn(async () => undefined);
jest.mock('../../AuditService', () => ({ getAuditService: () => ({ logAudit: (...a: unknown[]) => logAudit(...(a as [])) }) }));

import { runMessagePipeline } from '../message-pipeline';
import { ORCHESTRATOR } from '../../../config/capabilities';
import { EGRESS_POLICY } from '../../../config/egress-policy';
import { getEgressModeBlockedNotice } from '../../../prompts/egress-notices';
import type { RequestContext } from '../request-context';

const EXTERNAL = { providerId: 'gemini', modelId: 'gemini-2.5-flash', fullId: 'gemini:gemini-2.5-flash' };
const LOCAL = { providerId: 'local-llm', modelId: 'local-default', fullId: 'local-llm:local-default' };

function fakeService(captured: { resolved?: { fullId: string }; reqCtx?: RequestContext }) {
    return {
        providerRouter: {},
        client: { model: 'local-default' },
        buildUserContext: (userId: string) => ({ userId, role: 'user', tier: 'free' }),
        resolveLanguagePolicy: () => ({ resolvedLanguage: 'ko' }),
        resolveAgent: async () => ({ agentSelection: { primaryAgent: 'general' }, agentSystemMessage: '', selectedAgent: { id: 'general' } }),
        buildContextForLLM: async () => ({ finalEnhancedMessage: 'q' }),
        loadSkillBindings: async () => undefined,
        streamFromExternalProvider: async (resolved: { fullId: string }, _req: unknown, _onToken: unknown, _ctx: unknown, reqCtx: RequestContext) => {
            captured.resolved = resolved;
            captured.reqCtx = reqCtx;
            return '답';
        },
        setDelegatedTasks: () => undefined,
        recordMetricsAndVerify: () => undefined,
    } as never;
}

describe('runMessagePipeline — 반출 관문', () => {
    const enabled = ORCHESTRATOR.ENABLED;
    const policy = EGRESS_POLICY as { INTERNAL_ONLY_SENSITIVITY: string };
    beforeAll(() => { (ORCHESTRATOR as { ENABLED: boolean }).ENABLED = true; });
    afterAll(() => { (ORCHESTRATOR as { ENABLED: boolean }).ENABLED = enabled; });
    beforeEach(() => {
        jest.clearAllMocks();
        policy.INTERNAL_ONLY_SENSITIVITY = 'confidential';
        gate.mockImplementation(async (_r: unknown, input: { requestedModel?: string }) => (input.requestedModel === undefined && gate.mock.calls.length > 1 ? LOCAL : EXTERNAL));
        runOrchestrator.mockResolvedValue({ mode: 'simple', mediaMarkdowns: [], plannerMs: 1 });
    });
    afterEach(() => { policy.INTERNAL_ONLY_SENSITIVITY = 'off'; });

    it('민감 자료 턴: 외부 모델 → 내부 모델(고지), 오케스트레이터 건너뜀, 도구 문맥 내부 전용', async () => {
        const events: Array<{ type: string; metadata?: Record<string, unknown> }> = [];
        const captured: { resolved?: { fullId: string }; reqCtx?: RequestContext } = {};
        await runMessagePipeline(fakeService(captured), { message: '[대외비] 이 계약서 요약', userId: 'u1', userRole: 'user' } as never,
            () => undefined, undefined, undefined, undefined, undefined, undefined, (e) => { events.push(e as never); });
        expect(captured.resolved?.fullId).toBe(LOCAL.fullId);
        expect(events.find((e) => e.type === 'model_fallback')?.metadata).toMatchObject({ from: EXTERNAL.fullId, to: LOCAL.fullId, code: 'EGRESS_INTERNAL_ONLY' });
        expect(runOrchestrator).not.toHaveBeenCalled();
        expect(captured.reqCtx?.egressInternalOnly).toBe(true);
        expect(captured.reqCtx?.userContext.egressInternalOnly).toBe(true);
        await new Promise((r) => setImmediate(r)); // 감사 기록은 fire-and-forget
        expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'chat.egress_internal_only', userId: 'u1', details: expect.objectContaining({ blockedModel: EXTERNAL.fullId, sensitivity: 'confidential', matched: ['marking_ko'] }) }));
    });

    it('첨부(fileContext)만 민감해도 내부 전용', async () => {
        const captured: { resolved?: { fullId: string }; reqCtx?: RequestContext } = {};
        await runMessagePipeline(fakeService(captured), { message: '요약해줘', fileContext: 'CONFIDENTIAL — internal use only', userId: 'u1', userRole: 'user' } as never, () => undefined);
        expect(captured.resolved?.fullId).toBe(LOCAL.fullId);
    });

    it('평범한 턴은 종전 그대로 — 외부 모델·오케스트레이터', async () => {
        const captured: { resolved?: { fullId: string }; reqCtx?: RequestContext } = {};
        await runMessagePipeline(fakeService(captured), { message: '서울 날씨', userId: 'u1', userRole: 'user' } as never, () => undefined);
        expect(captured.resolved?.fullId).toBe(EXTERNAL.fullId);
        expect(runOrchestrator).toHaveBeenCalledTimes(1);
        expect(captured.reqCtx?.egressInternalOnly).toBeUndefined();
        expect(logAudit).not.toHaveBeenCalled();
    });

    it('기준 off(기본)면 민감 자료여도 종전 그대로', async () => {
        policy.INTERNAL_ONLY_SENSITIVITY = 'off';
        const captured: { resolved?: { fullId: string }; reqCtx?: RequestContext } = {};
        await runMessagePipeline(fakeService(captured), { message: '[대외비] 요약', userId: 'u1', userRole: 'user' } as never, () => undefined);
        expect(captured.resolved?.fullId).toBe(EXTERNAL.fullId);
    });

    it('내부 전용 턴에 외부 모드(이미지 생성)를 켜면 처리하지 않고 안내로 답한다', async () => {
        const tokens: string[] = [];
        const out = await runMessagePipeline(fakeService({}), { message: '[대외비] 그림', imageMode: true, userId: 'u1', userRole: 'user' } as never, (t) => { tokens.push(t); });
        expect(out).toBe(getEgressModeBlockedNotice('ko'));
        expect(tokens.join('')).toBe(out);
    });
});
