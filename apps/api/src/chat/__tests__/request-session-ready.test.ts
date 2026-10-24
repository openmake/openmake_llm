/**
 * processChat 세션 확보 알림(onSessionReady) — 세션 확보·사용자 메시지 저장이 끝나면 모델 실행 전에
 * 세션 id 를 알린다. 첫 턴을 응답 완료 전에 중단해도 다음 요청이 같은 세션을 잇게 하는 근거다.
 * 실제 ChatRequestHandler.processChat 을 부르고 DB·모델 경계만 막는다.
 */
const mockEnsureSession = jest.fn();
const mockSaveUser = jest.fn();
const mockSaveAssistant = jest.fn();
const mockProcessMessage = jest.fn();
const mockToolPath = jest.fn();

jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../request-persistence', () => ({
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
jest.mock('../tool-calling-path', () => ({ handleToolCallingPath: (...a: unknown[]) => mockToolPath(...a) }));
jest.mock('../../cluster/manager', () => ({}));
jest.mock('../../llm', () => ({ createClient: () => ({ model: 'engine-m' }) }));
jest.mock('../profile-resolver', () => ({ buildExecutionPlan: () => ({ resolvedEngine: 'engine-m' }) }));
jest.mock('../slash-command', () => ({ applySlashCommand: async (m: string) => m, languageDetectionInput: (r: string) => r }));
jest.mock('../../services/chat-service/language-resolver', () => ({ resolveLanguagePolicy: () => undefined }));
jest.mock('../fast-path-detector', () => ({ detectFastPath: () => ({ matched: false }) }));
jest.mock('../task-gate-session', () => ({ buildTaskGateSessionInput: () => ({}), startTaskGateSession: () => ({ finish: () => undefined }) }));
jest.mock('../../services/chat-service/history-summary-cache', () => ({ historySummaryCache: { get: () => null } }));
jest.mock('../history-presummary', () => ({ scheduleHistoryPresummary: () => undefined }));
jest.mock('../../providers/local-llm-provider', () => ({ LocalLLMProvider: jest.fn() }));
jest.mock('../../providers/provider-router', () => ({ ProviderRouter: jest.fn() }));
jest.mock('../../data/repositories/external-keys-repo', () => ({ ExternalKeysRepository: jest.fn() }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../data/conversation-db', () => ({ getConversationDB: () => ({}) }));
jest.mock('../request-artifacts', () => ({
    persistResponseArtifacts: async (r: string) => ({ cleanedResponse: r, extractedArtifacts: [] }),
}));
jest.mock('../request-branch-meta', () => ({ validateBranchMeta: async () => undefined }));
jest.mock('../../services/chat-service/thinking-summarizer', () => ({
    createThinkingSummarySession: () => ({ startFinal: async () => undefined, onThinking: () => undefined, getThinking: () => '' }),
}));

import { ChatRequestHandler } from '../request-handler';
import type { ChatRequestParams } from '../request-handler-types';

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

const ready = jest.fn();
function params(over: Record<string, unknown> = {}): ChatRequestParams {
    return {
        message: '안녕',
        model: 'm1',
        userContext: { authenticatedUserId: 'u1', userRole: 'user', userId: 'u1' },
        clusterManager: { getBestNode: () => undefined },
        onToken: () => undefined,
        onSessionReady: (id: string) => ready(id),
        ...over,
    } as unknown as ChatRequestParams;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockEnsureSession.mockImplementation(async (sid?: string) => sid ?? 's-new-0001');
    mockSaveUser.mockResolvedValue(undefined);
    mockSaveAssistant.mockResolvedValue('msg-1');
    mockProcessMessage.mockResolvedValue('응답');
});

describe('processChat onSessionReady', () => {
    it('publishes_session_after_user_persist_before_model_completion', async () => {
        const save = deferred<void>();
        const model = deferred<string>();
        mockSaveUser.mockReturnValue(save.promise);
        mockProcessMessage.mockReturnValue(model.promise);

        const run = ChatRequestHandler.processChat(params());
        await flush();
        expect(mockSaveUser).toHaveBeenCalledTimes(1);
        expect(ready).toHaveBeenCalledTimes(0); // 저장 전에는 알리지 않는다

        save.resolve();
        await flush();
        expect(mockProcessMessage).toHaveBeenCalledTimes(1); // 모델은 아직 응답 중
        expect(ready).toHaveBeenCalledTimes(1);
        expect(ready).toHaveBeenCalledWith('s-new-0001');
        expect(ready.mock.invocationCallOrder[0]).toBeLessThan(mockProcessMessage.mock.invocationCallOrder[0]);

        model.resolve('응답');
        const result = await run;
        expect(result.sessionId).toBe('s-new-0001');
        expect(ready).toHaveBeenCalledTimes(1);
    });

    it('기존 세션도 같은 id 로 한 번 알린다', async () => {
        await ChatRequestHandler.processChat(params({ sessionId: 's-existing-01' }));
        expect(mockEnsureSession.mock.calls[0][0]).toBe('s-existing-01');
        expect(ready).toHaveBeenCalledTimes(1);
        expect(ready).toHaveBeenCalledWith('s-existing-01');
    });

    it('saveHistory=false 여도 본문 미저장 정책은 그대로이고 저장 경로 성공 뒤 id 를 알린다', async () => {
        await ChatRequestHandler.processChat(params({ saveHistory: false }));
        expect(mockSaveUser.mock.calls[0][4]).toBe(false); // persistContent
        expect(ready).toHaveBeenCalledTimes(1);
        expect(ready).toHaveBeenCalledWith('s-new-0001');
    });

    it('비소유 세션 접근 거부면 알림·저장·모델 실행이 없다', async () => {
        mockEnsureSession.mockRejectedValue(new Error('SESSION_ACCESS_DENIED'));
        await expect(ChatRequestHandler.processChat(params({ sessionId: 's-other-user' }))).rejects.toMatchObject({ statusCode: 403 });
        expect(ready).not.toHaveBeenCalled();
        expect(mockSaveUser).not.toHaveBeenCalled();
        expect(mockProcessMessage).not.toHaveBeenCalled();
    });

    it('사용자 메시지 저장이 실패하면 알림·모델 실행이 없고 오류는 그대로 올라간다', async () => {
        mockSaveUser.mockRejectedValue(new Error('db down'));
        await expect(ChatRequestHandler.processChat(params())).rejects.toThrow('db down');
        expect(ready).not.toHaveBeenCalled();
        expect(mockProcessMessage).not.toHaveBeenCalled();
    });

    it('저장 대기 중 중단되면 저장이 끝나도 늦은 id 를 알리지 않고 모델도 시작하지 않는다(ABORTED)', async () => {
        const save = deferred<void>();
        mockSaveUser.mockReturnValue(save.promise);
        const controller = new AbortController();

        const run = ChatRequestHandler.processChat(params({ abortSignal: controller.signal }));
        await flush();
        controller.abort();
        save.resolve();

        await expect(run).rejects.toThrow('ABORTED');
        expect(ready).not.toHaveBeenCalled();
        expect(mockProcessMessage).not.toHaveBeenCalled();
    });

    it('자체 tools 경로도 도구 실행 전에 알린다', async () => {
        mockToolPath.mockResolvedValue({ response: '', sessionId: 's-new-0001', finish_reason: 'stop' });
        await ChatRequestHandler.processChat(params({ tools: [{ type: 'function', function: { name: 'f', parameters: {} } }] }));
        expect(ready).toHaveBeenCalledWith('s-new-0001');
        expect(ready.mock.invocationCallOrder[0]).toBeLessThan(mockToolPath.mock.invocationCallOrder[0]);
    });
});
