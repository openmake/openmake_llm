/**
 * 디버그 큐 재현 번들 연결(F24.7, 144) — 번들 미지정이면 세션 최근 번들을 붙이고(신고 문장 일치 시), 명시 null 이면 붙이지 않는다.
 */
const query = jest.fn(async () => ({ rows: [{ id: 'dq-1' }] }));
jest.mock('../models/unified-database', () => ({ getPool: () => ({ query }) }));
jest.mock('../retry-wrapper', () => ({ withRetry: (fn: () => unknown) => fn() }));

import { enqueueDebugCapture } from '../conversation-debug-queue';
import { captureReplay, clearReplayStore } from '../../observability/replay-capture';

const provider = { providerId: 'local-llm', modelId: 'm', fullId: 'm' };
const params = () => (query.mock.calls[0] as unknown as [string, unknown[]])[1];

beforeEach(() => { jest.clearAllMocks(); clearReplayStore(); });

describe('enqueueDebugCapture — 재현 번들', () => {
    it('세션의 최근 번들을 찾아 번들·request_id·절단 여부를 함께 저장', async () => {
        captureReplay('sess-1', { requestId: 'req-9', provider, messages: [{ role: 'user', content: '에러난 질문' }] });
        await enqueueDebugCapture({ sessionId: 'sess-1', userId: '3', reason: 'auto-error', userMessage: '에러난 질문', assistantMessage: '' });
        const p = params();
        expect(JSON.parse(String(p[8])).requestId).toBe('req-9');
        expect(p[9]).toBe('req-9');
        expect(p[10]).toBe(false);
    });

    it('신고 문장이 다르거나 replayBundle:null 이면 번들 없이 저장', async () => {
        captureReplay('sess-2', { requestId: 'req-1', provider, messages: [{ role: 'user', content: '다른 질문' }] });
        await enqueueDebugCapture({ sessionId: 'sess-2', userId: '3', reason: 'user-report', userMessage: '신고한 질문', assistantMessage: 'a' });
        expect(params()[8]).toBeNull();
        query.mockClear();
        await enqueueDebugCapture({ sessionId: 'sess-2', userId: '3', reason: 'user-report', userMessage: '다른 질문', assistantMessage: 'a', replayBundle: null });
        expect(params()[8]).toBeNull();
    });
});
