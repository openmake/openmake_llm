/**
 * 채팅 도구 승인 WS 이벤트(W3 S3) — 핸들러가 승인 대기·결정 콜백을 processChat 에 넘기고,
 * 불리면 `chat_approval_pending`/`chat_approval_decided` 를 messageId 와 함께 클라이언트에 보낸다.
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
import type { ExtendedWebSocket, WSMessage } from '../ws-types';
import type { ChatRequestParams } from '../../chat/request-handler-types';

it('승인 대기·결정 콜백이 messageId 를 단 WS 이벤트로 나간다', async () => {
    processChat.mockImplementation(async (p: ChatRequestParams) => {
        p.onChatApprovalPending?.({ approvalId: 'apv_chat:s1_a_0', toolName: 'write_file', args: { path: 'a.txt' }, riskClass: 'write', expiresAt: 123 });
        p.onChatApprovalDecided?.({ approvalId: 'apv_chat:s1_a_0', decision: 'rejected', reason: 'user' });
        throw new Error('ABORTED'); // 이후 경로(완료 처리)는 이 테스트의 관심 밖 — 조용히 끝나는 중단으로 빠진다
    });
    const sent: Array<Record<string, unknown>> = [];
    const ws = { OPEN: 1, readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) } as unknown as WebSocket;
    const extWs = { _abortController: null } as unknown as ExtendedWebSocket;
    const log = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;

    await handleChatMessage(ws, { type: 'chat', message: '파일 써 줘', model: 'm1' } as WSMessage, { cluster: {} as never, extWs, logger: log });

    expect(processChat).toHaveBeenCalledTimes(1);
    const pending = sent.find((e) => e.type === 'chat_approval_pending');
    const decided = sent.find((e) => e.type === 'chat_approval_decided');
    expect(pending).toEqual({
        type: 'chat_approval_pending', approvalId: 'apv_chat:s1_a_0', toolName: 'write_file', args: { path: 'a.txt' },
        riskClass: 'write', expiresAt: 123, messageId: expect.any(String),
    });
    expect(decided).toEqual({ type: 'chat_approval_decided', approvalId: 'apv_chat:s1_a_0', decision: 'rejected', reason: 'user', messageId: pending!.messageId });
});

it('approvalCards 는 명시 true 일 때만 processChat 에 true 로 간다(웹 채팅만 보낸다) — 없거나 다른 값이면 false', async () => {
    processChat.mockImplementation(async () => { throw new Error('ABORTED'); });
    const ws = { OPEN: 1, readyState: 1, send: () => undefined } as unknown as WebSocket;
    const log = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;
    const seen: unknown[] = [];
    for (const extra of [{ approvalCards: true }, {}, { approvalCards: 'true' }]) {
        processChat.mockClear();
        const extWs = { _abortController: null } as unknown as ExtendedWebSocket;
        await handleChatMessage(ws, { type: 'chat', message: '검색해 줘', model: 'm1', ...extra } as WSMessage, { cluster: {} as never, extWs, logger: log });
        seen.push((processChat.mock.calls[0][0] as ChatRequestParams).approvalCards);
    }
    expect(seen).toEqual([true, false, false]);
});
