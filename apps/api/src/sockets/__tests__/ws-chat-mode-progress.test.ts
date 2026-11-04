/**
 * 채팅 모드 진행 이벤트(PR-H1-1) — 모드 진행 1틱마다 구 이벤트(모드가 선언한 progressEventType)를 먼저,
 * 이어서 중립 이벤트 `chat_mode_progress{modeId}` 를 보낸다(이중 송출). 구 소비자는 미지 type 을 무시하므로 영향이 없다.
 */
import type { WebSocket } from 'ws';

const processChat = jest.fn();
jest.mock('../../chat/request-handler', () => ({
    ChatRequestHandler: {
        resolveUserContextFromWebSocket: () => ({ userId: 'guest', userRole: 'guest', userTier: 'free' }),
        processChat: (p: unknown) => processChat(p),
    },
}));
jest.mock('../../middlewares/chat-rate-limiter', () => ({ checkChatRateLimit: async () => null }));
jest.mock('../../tools/web-search/build-search-context', () => ({ buildWebSearchContext: async () => ({ webSearchContext: '', sources: [] }) }));
jest.mock('../../services/chat-service/turn-integrations', () => ({ collectContextRefs: () => undefined, collectTurnContexts: async () => ({ sources: [] }) }));
jest.mock('../../chat/request-idempotency', () => ({ claimClientRequestShared: async () => ({}) }));
jest.mock('../../chat/slash-command', () => ({
    applySlashCommand: async (m: string) => m, mergeActivatedSkillNames: (a: string[]) => a, languageDetectionInput: (r: string) => r,
}));

import { handleChatMessage } from '../ws-chat-handler';
import { __setChatModesForTest, DEFAULT_INPUT_POLICY, type ChatModeExtension } from '../../services/chat-service/chat-modes';
import type { ExtendedWebSocket, WSMessage } from '../ws-types';
import type { ChatRequestParams } from '../../chat/request-handler-types';

const MODE: ChatModeExtension = {
    id: 'mode-x', label: 'Mode X', availableOverRest: false, progressEventType: 'mode_x_progress',
    inputPolicy: { ...DEFAULT_INPUT_POLICY, pdfVision: false }, run: async () => '',
};

afterEach(() => __setChatModesForTest(null));

async function runWith(onProcess: (p: ChatRequestParams) => void) {
    __setChatModesForTest([MODE]);
    processChat.mockImplementation(async (p: ChatRequestParams) => { onProcess(p); throw new Error('ABORTED'); });
    const sent: Array<Record<string, unknown>> = [];
    const ws = { OPEN: 1, readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) } as unknown as WebSocket;
    const extWs = { _abortController: null } as unknown as ExtendedWebSocket;
    const log = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;
    await handleChatMessage(ws, { type: 'chat', message: '진행해 줘', model: 'm1', modes: { 'mode-x': true } } as unknown as WSMessage, { cluster: {} as never, extWs, logger: log });
    return sent;
}

it('진행 1틱에 구 이벤트와 chat_mode_progress 가 순서대로 나간다', async () => {
    const progress = { phase: 'step', progress: 40 };
    const sent = await runWith((p) => p.onModeProgress?.('mode-x', progress));
    const ticks = sent.filter((e) => e.type === 'mode_x_progress' || e.type === 'chat_mode_progress');
    expect(ticks).toEqual([
        { type: 'mode_x_progress', progress },
        { type: 'chat_mode_progress', modeId: 'mode-x', progress, messageId: expect.any(String) },
    ]);
});

it('등록되지 않은 모드의 진행은 어느 이벤트로도 나가지 않는다', async () => {
    const sent = await runWith((p) => p.onModeProgress?.('unknown-mode', { progress: 1 }));
    expect(sent.some((e) => e.type === 'chat_mode_progress' || e.type === 'mode_x_progress')).toBe(false);
});
