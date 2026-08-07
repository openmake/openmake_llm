/**
 * POST /api/chat/structured — 대화 기록 영속화 회귀 테스트.
 *
 * 2026-08-07: structured 라우트가 composeStructuredAnswer 를 직접 호출하면서
 * 사용자 질문·구조화 답변을 conversation DB 에 전혀 저장하지 않던 결함의 회귀 가드.
 * request-persistence 헬퍼(ensureSession/saveUserMessage/saveAssistantMessage)를
 * 재사용해 저장하며, saveHistory === false 는 본문 저장을 생략하고, 저장 실패는
 * 응답을 죽이지 않아야(fail-open) 한다.
 */
import express from 'express';
import request from 'supertest';

// 무거운 의존성 mock — 라우트의 저장 배선만 검증한다.
const ensureSession = jest.fn();
const saveUserMessage = jest.fn();
const saveAssistantMessage = jest.fn();
jest.mock('../../chat/request-persistence', () => ({
    ensureSession: (...a: unknown[]) => ensureSession(...a),
    saveUserMessage: (...a: unknown[]) => saveUserMessage(...a),
    saveAssistantMessage: (...a: unknown[]) => saveAssistantMessage(...a),
}));

const composeStructuredAnswer = jest.fn();
jest.mock('../../services/answer-composer', () => ({
    composeStructuredAnswer: (...a: unknown[]) => composeStructuredAnswer(...a),
}));

jest.mock('../../mcp/web-search/build-search-context', () => ({
    buildWebSearchContext: jest.fn().mockResolvedValue({ webSearchContext: '' }),
}));

jest.mock('../../llm/client', () => ({
    createClient: jest.fn(() => ({ model: 'test-model', chat: jest.fn() })),
}));

import chatRouter from '../../routes/chat.routes';

const MARKDOWN = '# 제목\n\n답변 본문';
const COMPOSED = {
    intent: 'explanation',
    structured: { intent: 'explanation', title: '제목', conclusion: '결론', sections: [], confidence: 'high' },
    markdown: MARKDOWN,
};

const mkApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/chat', chatRouter);
    return app;
};

const post = (body: Record<string, unknown>) =>
    request(mkApp()).post('/api/chat/structured').send(body);

describe('POST /api/chat/structured — 대화 기록 영속화', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        ensureSession.mockResolvedValue('sess-new');
        composeStructuredAnswer.mockResolvedValue(COMPOSED);
    });

    it('sessionId 미지정 시 ensureSession 으로 자동 생성하고 질문·답변을 저장한다', async () => {
        const res = await post({ message: '안녕', anonSessionId: 'anon-xyz', userLanguage: 'ko' });

        expect(res.status).toBe(200);
        expect(ensureSession).toHaveBeenCalledTimes(1);
        // (sessionId, authenticatedUserId, message, anonSessionId, userRole)
        expect(ensureSession.mock.calls[0][0]).toBeUndefined();
        expect(ensureSession.mock.calls[0][2]).toBe('안녕');
        expect(ensureSession.mock.calls[0][3]).toBe('anon-xyz');

        // user 메시지 = 원 질문, persistContent(마지막 인자) = true
        expect(saveUserMessage).toHaveBeenCalledWith('sess-new', 'anon-xyz', '안녕', 'test-model', true);
        // assistant 메시지 = 렌더된 마크다운, persistContent = true
        const asstCall = saveAssistantMessage.mock.calls[0];
        expect(asstCall[0]).toBe('sess-new');
        expect(asstCall[2]).toBe(MARKDOWN);
        expect(asstCall[5]).toBe(true);

        // 응답 본문에 세션 id 노출 (클라이언트 세션 연속용)
        expect(res.body?.data?.sessionId).toBe('sess-new');
    });

    it('saveHistory === false 는 본문 저장을 생략한다(persistContent=false)', async () => {
        const res = await post({ message: '안녕', anonSessionId: 'anon-xyz', saveHistory: false });

        expect(res.status).toBe(200);
        expect(saveUserMessage).toHaveBeenCalledWith('sess-new', 'anon-xyz', '안녕', 'test-model', false);
        expect(saveAssistantMessage.mock.calls[0][5]).toBe(false);
    });

    it('저장 실패는 응답을 죽이지 않는다(fail-open)', async () => {
        ensureSession.mockRejectedValue(new Error('DB down'));

        const res = await post({ message: '안녕', anonSessionId: 'anon-xyz' });

        expect(res.status).toBe(200);
        expect(res.body?.data?.markdown).toBe(MARKDOWN);
        // 저장 실패 시 세션 id 는 노출되지 않는다
        expect(res.body?.data?.sessionId).toBeUndefined();
    });
});
