/**
 * openai-compat /chat/completions — OpenMake 확장 files[] 첨부 회귀 테스트.
 *
 * Discord gateway 등 REST 클라이언트가 문서 첨부(base64)를 보내면 텍스트로 추출해
 * processChat 의 fileContext 로 넘겨야 한다(스트리밍/비스트리밍 대칭).
 * 실제 추출기(JVM 등)는 돌리지 않도록 doc-extractor 를 mock 한다.
 */
import express from 'express';
import request from 'supertest';
import { ChatRequestHandler } from '../../chat/request-handler';
import type { ClusterManager } from '../../cluster/manager';
import type { AttachedFileInput } from '../../services/chat-service/attach-context';
import { FILE_ATTACH_LIMITS } from '../../config/runtime-limits';

jest.mock('../../chat/profile-resolver', () => ({
    ...jest.requireActual('../../chat/profile-resolver'),
    listAvailableModels: () => [{ id: 'test-model' }],
}));

// 세션 연속성 조회가 실제 pg pool 에 닿지 않도록 격리 (openai-compat-images 테스트와 동일)
jest.mock('../../data/repositories/oaicompat-session-repo', () => ({
    OpenAICompatSessionRepository: jest.fn().mockImplementation(() => ({
        findByKeyForUser: jest.fn().mockResolvedValue(undefined),
        findByKeyForAnon: jest.fn().mockResolvedValue(undefined),
        tagKey: jest.fn().mockResolvedValue(undefined),
    })),
}));

// 추출기 mock: data(base64) → content 로 in-place 치환 (실제 계약과 같은 모양)
jest.mock('../../services/chat-service/doc-extractor', () => ({
    // extracted 판정(isBinaryDocumentName)은 실제 규칙 그대로 쓴다
    isBinaryDocumentName: jest.requireActual('../../services/chat-service/doc-extractor').isBinaryDocumentName,
    extractAttachedDocuments: jest.fn(async (files: AttachedFileInput[] | undefined) => {
        for (const f of files ?? []) {
            if (typeof f.data === 'string') {
                f.content = `추출본:${f.name}`;
                delete f.data;
            }
        }
    }),
}));

import openaiCompatRouter, { setClusterManager } from '../../routes/openai-compat.routes';
import { extractAttachedDocuments } from '../../services/chat-service/doc-extractor';

const mkApp = () => {
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use('/api/v1', openaiCompatRouter);
    return app;
};

const baseBody = (stream: boolean, files: unknown) => ({
    model: 'test-model',
    stream,
    messages: [{ role: 'user', content: '첨부를 요약해' }],
    files,
});

describe('openai-compat files[] 확장', () => {
    let processChatSpy: jest.SpyInstance;

    beforeAll(() => {
        setClusterManager({} as unknown as ClusterManager);
    });

    beforeEach(() => {
        (extractAttachedDocuments as jest.Mock).mockClear();
        processChatSpy = jest.spyOn(ChatRequestHandler, 'processChat').mockResolvedValue({
            response: 'ok',
            sessionId: 'test-session',
            model: 'test-model',
        } as never);
    });

    afterEach(() => {
        processChatSpy.mockRestore();
    });

    it.each([false, true])('stream=%s: files 를 추출해 fileContext 로 전달한다', async (stream) => {
        const res = await request(mkApp())
            .post('/api/v1/chat/completions')
            .send(baseBody(stream, [{ name: 'report.pdf', type: 'application/pdf', size: 3, data: 'QUJD' }]));

        expect(res.status).toBe(200);
        expect(extractAttachedDocuments).toHaveBeenCalledTimes(1);
        expect(processChatSpy).toHaveBeenCalledTimes(1);
        const args = processChatSpy.mock.calls[0][0];
        expect(typeof args.fileContext).toBe('string');
        expect(args.fileContext).toContain('report.pdf');
        expect(args.fileContext).toContain('추출본:report.pdf');
    });

    it('files 가 없으면 fileContext 를 넘기지 않는다', async () => {
        const res = await request(mkApp())
            .post('/api/v1/chat/completions')
            .send({ model: 'test-model', messages: [{ role: 'user', content: '안녕' }] });
        expect(res.status).toBe(200);
        expect(extractAttachedDocuments).not.toHaveBeenCalled();
        expect(processChatSpy.mock.calls[0][0].fileContext).toBeUndefined();
    });

    it.each([false, true])('stream=%s: 위임 작업용 attachments 에 추출 전 원본과 이미지를 싣는다', async (stream) => {
        const res = await request(mkApp())
            .post('/api/v1/chat/completions')
            .send({
                ...baseBody(stream, [{ name: 'report.pdf', type: 'application/pdf', size: 3, data: 'QUJD' }]),
                messages: [{ role: 'user', content: [
                    { type: 'text', text: '첨부를 분석해, 백그라운드로' },
                    { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
                ] }],
            });
        expect(res.status).toBe(200);
        expect(processChatSpy.mock.calls[0][0].attachments).toEqual({
            files: [{ name: 'report.pdf', type: 'application/pdf', size: 3, content: '추출본:report.pdf', data: 'QUJD', extracted: true }],
            images: ['data:image/png;base64,iVBORw0KGgo='],
        });
    });

    it('첨부가 없으면 attachments 를 넘기지 않는다', async () => {
        await request(mkApp())
            .post('/api/v1/chat/completions')
            .send({ model: 'test-model', messages: [{ role: 'user', content: '안녕' }] });
        expect(processChatSpy.mock.calls[0][0]).not.toHaveProperty('attachments');
    });

    it.each([
        ['name 누락', [{ data: 'QUJD' }]],
        ['data 가 문자열이 아님', [{ name: 'a.pdf', data: 123 }]],
        ['항목이 객체가 아님', ['a.pdf']],
        ['배열이 아님', { name: 'a.pdf', data: 'QUJD' }],
    ])('형식 불량(%s)은 400', async (_label, files) => {
        const res = await request(mkApp())
            .post('/api/v1/chat/completions')
            .send(baseBody(false, files));
        expect(res.status).toBe(400);
        expect(processChatSpy).not.toHaveBeenCalled();
        expect(extractAttachedDocuments).not.toHaveBeenCalled();
    });

    it('개수 상한(MAX_FILES) 초과는 400', async () => {
        const files = Array.from({ length: FILE_ATTACH_LIMITS.MAX_FILES + 1 }, (_, i) => ({ name: `f${i}.txt`, data: 'QQ==' }));
        const res = await request(mkApp())
            .post('/api/v1/chat/completions')
            .send(baseBody(false, files));
        expect(res.status).toBe(400);
        expect(processChatSpy).not.toHaveBeenCalled();
    });
});
