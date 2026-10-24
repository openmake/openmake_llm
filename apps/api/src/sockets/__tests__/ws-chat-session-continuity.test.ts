/**
 * 첫 턴 중단 후 대화 연속성 — 실제 WS 핸들러 → 실제 ChatRequestHandler.processChat 경로.
 * 세션 확보·사용자 저장 뒤 모델 응답 전에 `session_created` 가 나가야, 그 사이 Stop 해도
 * 다음 전송이 같은 세션 id 로 이어진다(응답 완료 뒤에만 보내면 새 세션이 생겨 대화가 갈라졌다).
 * DB·모델 경계만 막는다.
 */
import type { WebSocket } from 'ws';

const mockEnsureSession = jest.fn();
const mockSaveUser = jest.fn();
const mockSaveAssistant = jest.fn();
const mockProcessMessage = jest.fn();

jest.mock('../../chat/request-persistence', () => ({
    ensureSession: (...a: unknown[]) => mockEnsureSession(...a),
    saveUserMessage: (...a: unknown[]) => mockSaveUser(...a),
    saveAssistantMessage: (...a: unknown[]) => mockSaveAssistant(...a),
}));
jest.mock('../../services/ChatService', () => ({
    ChatService: jest.fn().mockImplementation(() => ({
        processMessage: (...a: unknown[]) => mockProcessMessage(...a),
        getDelegatedTasks: () => [],
    })),
}));
jest.mock('../../middlewares/chat-rate-limiter', () => ({ checkChatRateLimit: async () => null }));
jest.mock('../../tools/web-search/build-search-context', () => ({ buildWebSearchContext: async () => ({ webSearchContext: '', sources: [] }) }));
jest.mock('../../services/chat-service/turn-integrations', () => ({
    collectContextRefs: () => undefined, collectTurnContexts: async () => ({ sources: [] }), getActiveChatTurnIntegrations: () => [],
}));
jest.mock('../../chat/request-idempotency', () => ({ claimClientRequestShared: async () => ({}) }));
jest.mock('../../chat/slash-command', () => ({
    applySlashCommand: async (m: string) => m, mergeActivatedSkillNames: (a: string[]) => a, languageDetectionInput: (r: string) => r,
}));
jest.mock('../../chat/model-selector', () => ({ selectOptimalModel: async () => ({ model: 'm1', reason: '' }) }));
jest.mock('../../services/chat-service/answer-verifier', () => ({ dispatchAnswerVerification: () => undefined }));
jest.mock('../../data/conversation-debug-queue', () => ({ enqueueDebugCapture: async () => null, DEBUG_QUEUE_TTL_MS: { 'auto-error': 1 } }));
jest.mock('../../runtime-ports/tool-runtime', () => ({ getToolRuntime: () => ({ onChatStart: async () => undefined, onChatEnd: async () => undefined }) }));
jest.mock('../../llm', () => ({ createClient: () => ({ model: 'engine-m' }) }));
jest.mock('../../chat/profile-resolver', () => ({ buildExecutionPlan: () => ({ resolvedEngine: 'engine-m' }) }));
jest.mock('../../services/chat-service/language-resolver', () => ({ resolveLanguagePolicy: () => undefined }));
jest.mock('../../chat/fast-path-detector', () => ({ detectFastPath: () => ({ matched: false }) }));
jest.mock('../../chat/task-gate-session', () => ({ buildTaskGateSessionInput: () => ({}), startTaskGateSession: () => ({ finish: () => undefined }) }));
jest.mock('../../services/chat-service/history-summary-cache', () => ({ historySummaryCache: { get: () => null } }));
jest.mock('../../chat/history-presummary', () => ({ scheduleHistoryPresummary: () => undefined }));
jest.mock('../../providers/local-llm-provider', () => ({ LocalLLMProvider: jest.fn() }));
jest.mock('../../providers/provider-router', () => ({ ProviderRouter: jest.fn() }));
jest.mock('../../data/repositories/external-keys-repo', () => ({ ExternalKeysRepository: jest.fn() }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../data/conversation-db', () => ({ getConversationDB: () => ({}) }));
jest.mock('../../chat/request-artifacts', () => ({
    persistResponseArtifacts: async (r: string) => ({ cleanedResponse: r, extractedArtifacts: [] }),
}));
jest.mock('../../chat/request-branch-meta', () => ({ validateBranchMeta: async () => undefined }));
jest.mock('../../services/chat-service/thinking-summarizer', () => ({
    createThinkingSummarySession: () => ({ startFinal: async () => undefined, onThinking: () => undefined, getThinking: () => '' }),
}));

import { handleChatMessage } from '../ws-chat-handler';
import type { ExtendedWebSocket, WSMessage } from '../ws-types';

type Sent = Array<Record<string, unknown>>;
interface ChatReq { sessionId: string; history?: unknown; abortSignal?: AbortSignal }

const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
const log = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;

function socket(userId: string | null = null) {
    const sent: Sent = [];
    const ws = { OPEN: 1, readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) } as unknown as WebSocket;
    const extWs = {
        OPEN: 1, readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)),
        _abortController: null, _authenticatedUserId: userId, _authenticatedUserRole: userId ? 'user' : 'guest',
    } as unknown as ExtendedWebSocket;
    return { ws, extWs, sent };
}
const chat = (s: ReturnType<typeof socket>, msg: Partial<WSMessage>) =>
    handleChatMessage(s.ws, { type: 'chat', model: 'm1', ...msg } as WSMessage, { cluster: { getBestNode: () => undefined } as never, extWs: s.extWs, logger: log });
/** handler.ts handleAbort 와 같은 순서 — abort 후 소켓의 컨트롤러를 비운다 */
function stop(s: ReturnType<typeof socket>) {
    const ac = s.extWs._abortController;
    ac?.abort();
    s.extWs._abortController = null;
}
/** 중단 신호가 올 때까지 응답을 막는 모델 */
const blockUntilAbort = (req: ChatReq) => new Promise<string>((_res, rej) => {
    req.abortSignal?.addEventListener('abort', () => rej(new Error('ABORTED')));
});
const sessionEvents = (sent: Sent) => sent.filter((e) => e.type === 'session_created');

let created = 0;
beforeEach(() => {
    jest.clearAllMocks();
    [mockEnsureSession, mockSaveUser, mockSaveAssistant, mockProcessMessage].forEach((m) => m.mockReset()); // Once 큐가 다음 테스트로 새지 않게
    created = 0;
    mockEnsureSession.mockImplementation(async (sid?: string, userId?: string | null) => {
        if (sid) return sid;
        created++;
        return `s-${userId ?? 'guest'}-${String(created).padStart(4, '0')}`;
    });
    mockSaveUser.mockResolvedValue(undefined);
    mockSaveAssistant.mockResolvedValue('msg-1');
});

describe('WS 첫 턴 세션 연속성', () => {
    it('keeps_session_for_followup_after_abort', async () => {
        const s = socket();
        mockProcessMessage.mockImplementationOnce(blockUntilAbort).mockResolvedValueOnce('CANCEL_INPUT_RECOVERED');

        const first = chat(s, { message: '첫 질문' });
        await flush();
        expect(mockProcessMessage).toHaveBeenCalledTimes(1); // 모델 응답 대기 중
        expect(sessionEvents(s.sent)).toEqual([{ type: 'session_created', sessionId: 's-guest-0001' }]);

        stop(s);
        await first;

        // 클라이언트는 받은 session_created 를 채택해 다음 전송에 싣는다(화면 이력과 함께)
        const adopted = sessionEvents(s.sent)[0]?.sessionId as string | undefined;
        const history = [{ role: 'user', content: '첫 질문' }];
        await chat(s, { message: '후속', sessionId: adopted, history } as Partial<WSMessage>);

        expect(created).toBe(1);
        expect(mockEnsureSession.mock.calls[1][0]).toBe('s-guest-0001');
        const followReq = mockProcessMessage.mock.calls[1][0] as ChatReq;
        expect(followReq.sessionId).toBe('s-guest-0001');
        expect(followReq.history).toEqual(history);
        expect(sessionEvents(s.sent)).toHaveLength(1);
    });

    it('정상 완료면 session_created 는 모델 완료 전에 한 번, 완료 뒤에도 총 한 번이다', async () => {
        const s = socket();
        let finish!: (v: string) => void;
        mockProcessMessage.mockImplementationOnce(() => new Promise<string>((res) => { finish = res; }));

        const run = chat(s, { message: '안녕' });
        await flush();
        expect(sessionEvents(s.sent)).toHaveLength(1);

        finish('응답');
        await run;
        const types = s.sent.map((e) => e.type);
        expect(sessionEvents(s.sent)).toEqual([{ type: 'session_created', sessionId: 's-guest-0001' }]);
        expect(types.indexOf('session_created')).toBeLessThan(types.indexOf('done'));
    });

    it('기존 세션이면 새 세션 생성·session_created 가 없다', async () => {
        const s = socket();
        mockProcessMessage.mockResolvedValueOnce('응답');
        await chat(s, { message: '이어서', sessionId: 's-existing-0001' });
        expect(created).toBe(0);
        expect((mockProcessMessage.mock.calls[0][0] as ChatReq).sessionId).toBe('s-existing-0001');
        expect(sessionEvents(s.sent)).toHaveLength(0);
    });

    it('비소유 세션 접근 거부면 id 발행·모델 실행이 없다', async () => {
        const s = socket('u1');
        mockEnsureSession.mockRejectedValueOnce(new Error('SESSION_ACCESS_DENIED'));
        await chat(s, { message: '남의 세션', sessionId: 's-u2-00000001' });
        expect(sessionEvents(s.sent)).toHaveLength(0);
        expect(mockProcessMessage).not.toHaveBeenCalled();
        expect(s.sent.some((e) => e.type === 'error')).toBe(true);
    });

    it('두 사용자 소켓의 조기 id 는 서로에게 가지 않는다', async () => {
        const a = socket('u1');
        const b = socket('u2');
        mockProcessMessage.mockImplementation(blockUntilAbort);
        const runA = chat(a, { message: 'A' });
        const runB = chat(b, { message: 'B' });
        await flush();
        expect(sessionEvents(a.sent).map((e) => e.sessionId)).toEqual(['s-u1-0001']);
        expect(sessionEvents(b.sent).map((e) => e.sessionId)).toEqual(['s-u2-0002']);
        stop(a);
        stop(b);
        await Promise.all([runA, runB]);
        expect(a.sent.some((e) => e.sessionId === 's-u2-0002')).toBe(false);
        expect(b.sent.some((e) => e.sessionId === 's-u1-0001')).toBe(false);
    });

    it('A 중단 뒤 B 를 시작하고 A 가 늦게 끝나도 B 의 중단 컨트롤러는 남아 B 를 멈출 수 있다', async () => {
        const s = socket();
        let rejectA!: (e: unknown) => void;
        mockProcessMessage
            .mockImplementationOnce(() => new Promise<string>((_res, rej) => { rejectA = rej; })) // A: 중단 신호를 늦게 반영
            .mockImplementationOnce(blockUntilAbort); // B

        const runA = chat(s, { message: 'A' });
        await flush();
        stop(s);
        const runB = chat(s, { message: 'B', sessionId: 's-guest-0001' });
        await flush();
        const controllerB = s.extWs._abortController;
        expect(controllerB).not.toBeNull();

        rejectA(new Error('ABORTED')); // A 의 catch/finally 가 B 시작 뒤에 돈다
        await runA;
        expect(s.extWs._abortController).toBe(controllerB);

        stop(s);
        await runB;
        expect(controllerB?.signal.aborted).toBe(true);
    });

    it('첫 턴이 id 를 받은 뒤 스트림 도중 실패하면 부분 응답을 그 새 세션에 남긴다', async () => {
        const s = socket();
        mockProcessMessage.mockImplementationOnce(async (_req: ChatReq, onToken: (t: string) => void) => {
            onToken('부분 답');
            throw new Error('upstream broke');
        });
        await chat(s, { message: '질문' });
        expect(mockSaveAssistant).toHaveBeenCalledTimes(1);
        expect(mockSaveAssistant.mock.calls[0][0]).toBe('s-guest-0001');
        expect(String(mockSaveAssistant.mock.calls[0][2])).toContain('부분 답');
    });
});
