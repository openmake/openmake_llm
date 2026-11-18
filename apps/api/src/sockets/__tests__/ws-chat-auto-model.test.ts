/**
 * WS "자동" 모델이 커스텀 에이전트 배정 모델을 가리던 결함(2026-11-18) 재현·회귀.
 * WS 핸들러는 "자동"을 실제 모델 이름으로 치환하지 않고 파이프라인에 undefined 로 넘겨야
 * applyAgentModelOverride 가 에이전트 배정 모델을 적용할 수 있다.
 */
import type { WebSocket } from 'ws';

const processChat = jest.fn();
const loadUserAgent = jest.fn();
jest.mock('../../chat/request-handler', () => ({
    ChatRequestHandler: {
        resolveUserContextFromWebSocket: () => ({ userId: 'u1', userRole: 'user', userTier: 'free' }),
        processChat: (p: unknown) => processChat(p),
    },
}));
jest.mock('../../chat/model-selector', () => ({ selectOptimalModel: async () => ({ model: 'local-default', reason: '' }) }));
jest.mock('../../chat/execution-plan-builder', () => ({ getExecutionPlanBuilder: () => ({ loadUserAgent }) }));
jest.mock('../../middlewares/chat-rate-limiter', () => ({ checkChatRateLimit: async () => null }));
jest.mock('../../tools/web-search/build-search-context', () => ({ buildWebSearchContext: async () => ({ webSearchContext: '', sources: [] }) }));
jest.mock('../../services/chat-service/turn-integrations', () => ({ collectContextRefs: () => undefined, collectTurnContexts: async () => ({ sources: [] }) }));
jest.mock('../../chat/request-idempotency', () => ({ claimClientRequestShared: async () => ({}) }));
jest.mock('../../chat/slash-command', () => ({
    applySlashCommand: async (m: string) => m, mergeActivatedSkillNames: (a: string[]) => a, languageDetectionInput: (r: string) => r,
}));

import { handleChatMessage } from '../ws-chat-handler';
import { applyAgentModelOverride } from '../../services/chat-service/agent-model-override';
import type { ExtendedWebSocket, WSMessage } from '../ws-types';
import type { ChatRequestParams } from '../../chat/request-handler-types';

// WS 핸들러가 파이프라인에 실제로 넘긴 인자. processChat 이 정확히 1번 불렸고 에이전트 id 가 실렸음을 먼저 단언한다
// (미호출이면 model 이 undefined 로 읽혀 아래 단언이 거짓 통과한다).
async function paramsSentToPipeline(model: string | undefined): Promise<ChatRequestParams> {
    processChat.mockReset();
    processChat.mockImplementation(async () => { throw new Error('ABORTED'); });
    const ws = { OPEN: 1, readyState: 1, send: () => undefined } as unknown as WebSocket;
    const extWs = { _abortController: null, _authenticatedUserId: 'u1', _authenticatedUserRole: 'user' } as unknown as ExtendedWebSocket;
    const log = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;
    await handleChatMessage(ws, { type: 'chat', message: '안녕', model, userAgentId: 'agent-1' } as unknown as WSMessage, { cluster: {} as never, extWs, logger: log });
    expect(processChat).toHaveBeenCalledTimes(1);
    const params = processChat.mock.calls[0][0] as ChatRequestParams;
    expect(params.userAgentId).toBe('agent-1');
    return params;
}

beforeEach(() => loadUserAgent.mockReset().mockResolvedValue({ id: 'agent-1', name: 'A', model: 'chatgpt:gpt-x' }));

it.each(['default', '', undefined])('자동(%p) + 모델이 배정된 에이전트 → 에이전트 모델이 게이트에 도달한다', async (auto) => {
    const params = await paramsSentToPipeline(auto);
    expect(params.model).toBeUndefined(); // 재현 지점 — 수정 전: 'local-default' 가 넘어가 여기서 실패
    const gated = await applyAgentModelOverride(params.model, params.userAgentId, 'u1');
    expect(gated).toEqual({ model: 'chatgpt:gpt-x', fromAgent: true });
    expect(loadUserAgent).toHaveBeenCalledTimes(1);
});

it('사용자가 고른 모델은 에이전트 배정보다 우선한다', async () => {
    const params = await paramsSentToPipeline('gemini:g-1');
    expect(params.model).toBe('gemini:g-1');
    expect(await applyAgentModelOverride(params.model, params.userAgentId, 'u1')).toEqual({ model: 'gemini:g-1', fromAgent: false });
    expect(loadUserAgent).not.toHaveBeenCalled();
});
