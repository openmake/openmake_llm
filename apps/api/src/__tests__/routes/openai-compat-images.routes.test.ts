/**
 * openai-compat /chat/completions — images 전달 스트리밍/비스트리밍 대칭 회귀 테스트.
 *
 * 2026-08-03: 비스트리밍 분기만 processChat 에 images 를 전달하지 않아
 * vision 입력이 조용히 유실되던 결함의 회귀 가드. 두 분기 모두
 * converted.images 가 있으면 동일하게 전달해야 한다.
 */
import express from 'express';
import request from 'supertest';
import { ChatRequestHandler } from '../../chat/request-handler';
import type { ClusterManager } from '../../cluster/manager';

jest.mock('../../chat/profile-resolver', () => ({
    ...jest.requireActual('../../chat/profile-resolver'),
    listAvailableModels: () => [{ id: 'test-model' }],
}));

// 세션 연속성 조회는 실제 pg pool 에 닿는다 — DB 없는 CI 에선 연결 시도가 hang 해
// jest 타임아웃을 초과하므로(로컬은 빠른 실패 → fail-open 통과) repository 를 격리한다.
jest.mock('../../data/repositories/oaicompat-session-repo', () => ({
    OpenAICompatSessionRepository: jest.fn().mockImplementation(() => ({
        findByKeyForUser: jest.fn().mockResolvedValue(undefined),
        findByKeyForAnon: jest.fn().mockResolvedValue(undefined),
        tagKey: jest.fn().mockResolvedValue(undefined),
    })),
}));

import openaiCompatRouter, { setClusterManager } from '../../routes/openai-compat.routes';

const IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

const mkApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1', openaiCompatRouter);
    return app;
};

const visionBody = (stream: boolean) => ({
    model: 'test-model',
    stream,
    messages: [
        {
            role: 'user',
            content: [
                { type: 'text', text: '이 이미지를 설명해' },
                { type: 'image_url', image_url: { url: IMAGE_DATA_URL } },
            ],
        },
    ],
});

describe('openai-compat images 대칭 (stream vs non-stream)', () => {
    let processChatSpy: jest.SpyInstance;

    beforeAll(() => {
        setClusterManager({} as unknown as ClusterManager);
    });

    beforeEach(() => {
        processChatSpy = jest.spyOn(ChatRequestHandler, 'processChat').mockResolvedValue({
            response: 'ok',
            sessionId: 'test-session',
            model: 'test-model',
        } as never);
    });

    afterEach(() => {
        processChatSpy.mockRestore();
    });

    it('비스트리밍 분기가 images 를 processChat 에 전달한다', async () => {
        const res = await request(mkApp())
            .post('/api/v1/chat/completions')
            .send(visionBody(false));

        expect(res.status).toBe(200);
        expect(processChatSpy).toHaveBeenCalledTimes(1);
        const args = processChatSpy.mock.calls[0][0];
        expect(Array.isArray(args.images)).toBe(true);
        expect(args.images.length).toBeGreaterThan(0);
    });

    it('스트리밍 분기가 images 를 processChat 에 전달한다', async () => {
        const res = await request(mkApp())
            .post('/api/v1/chat/completions')
            .send(visionBody(true));

        expect(res.status).toBe(200);
        expect(processChatSpy).toHaveBeenCalledTimes(1);
        const args = processChatSpy.mock.calls[0][0];
        expect(Array.isArray(args.images)).toBe(true);
        expect(args.images.length).toBeGreaterThan(0);
    });

    it('이미지 없는 요청은 두 분기 모두 images 를 전달하지 않는다', async () => {
        for (const stream of [false, true]) {
            processChatSpy.mockClear();
            const res = await request(mkApp())
                .post('/api/v1/chat/completions')
                .send({
                    model: 'test-model',
                    stream,
                    messages: [{ role: 'user', content: '안녕' }],
                });
            expect(res.status).toBe(200);
            const args = processChatSpy.mock.calls[0][0];
            expect(args.images).toBeUndefined();
        }
    });
});
