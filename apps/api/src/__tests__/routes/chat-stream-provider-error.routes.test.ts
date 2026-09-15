/**
 * POST /api/chat/stream — ProviderError 가 SSE 이벤트에 code 를 싣는지 회귀 테스트.
 *
 * 2026-09-16: REST(글로벌 errorHandler)·WS 는 code 별로 응답했지만 SSE catch 는
 * ProviderError 를 구분하지 않아 정책 차단(403)이 "스트리밍 중 오류가 발생했습니다" 로만 나갔다.
 *
 * supertest 는 요청 본문 소비 직후 req 'close' 를 발생시켜 라우트의 aborted 가드에 걸리므로
 * (실제 HTTP 클라이언트와 다름), 라우터 스택에서 핸들러를 꺼내 가짜 req/res 로 직접 호출한다.
 */
import { EventEmitter } from 'events';
import type { Request, Response } from 'express';

jest.mock('../../llm/client', () => ({
    createClient: jest.fn(() => ({ model: 'test-model', chat: jest.fn() })),
}));

import chatRouter from '../../routes/chat.routes';
import { ChatRequestHandler } from '../../chat/request-handler';
import { ProviderError, PROVIDER_ERROR_HTTP_STATUS } from '../../providers/provider-errors';

type Layer = { route?: { path: string; stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }> } };
const streamHandler = () => {
    const layer = (chatRouter as unknown as { stack: Layer[] }).stack.find((l) => l.route?.path === '/stream');
    if (!layer?.route) throw new Error('/stream 라우트를 찾지 못했다');
    return layer.route.stack[layer.route.stack.length - 1].handle;
};

const invoke = async () => {
    const req = Object.assign(new EventEmitter(), {
        body: { message: 'hi', model: 'nvidia:x', anonSessionId: 'anon-sse' },
    }) as unknown as Request;
    const chunks: string[] = [];
    const res = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        write: (c: string) => { chunks.push(c); return true; },
        end: jest.fn(),
    } as unknown as Response;
    await streamHandler()(req, res);
    return chunks.join('').split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
};

describe('POST /api/chat/stream — ProviderError → SSE code', () => {
    let spy: jest.SpyInstance;
    afterEach(() => spy?.mockRestore());

    it('정책 차단은 code MODEL_ACCESS_RESTRICTED 와 status 403 을 이벤트로 내보낸다', async () => {
        spy = jest.spyOn(ChatRequestHandler, 'processChat')
            .mockRejectedValue(new ProviderError('MODEL_ACCESS_RESTRICTED', '관리자 정책으로 사용할 수 없는 모델입니다'));
        const events = await invoke();
        expect(events).toEqual([{
            error: '관리자 정책으로 사용할 수 없는 모델입니다',
            code: 'MODEL_ACCESS_RESTRICTED',
            status: PROVIDER_ERROR_HTTP_STATUS.MODEL_ACCESS_RESTRICTED,
        }]);
        expect(events[0].status).toBe(403);
    });

    it('ProviderError 가 아닌 오류는 종전처럼 일반 문구만 내보낸다(code 없음)', async () => {
        spy = jest.spyOn(ChatRequestHandler, 'processChat').mockRejectedValue(new Error('boom'));
        expect(await invoke()).toEqual([{ error: '스트리밍 중 오류가 발생했습니다' }]);
    });
});
