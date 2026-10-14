/**
 * openai-compat /chat/completions — OpenMake 확장 message.agent_tasks (2026-10-14).
 *
 * 채팅 중 모델이 delegate_agent_task 로 백그라운드 작업을 만들면 REST 클라이언트(Discord 봇)가 그 작업을
 * 지켜볼 수 있도록 비스트리밍 응답에 작업 목록을 동봉한다. 없으면 필드를 생략한다.
 */
import express from 'express';
import request from 'supertest';
import { ChatRequestHandler } from '../../chat/request-handler';
import type { ClusterManager } from '../../cluster/manager';

jest.mock('../../chat/profile-resolver', () => ({
    ...jest.requireActual('../../chat/profile-resolver'),
    listAvailableModels: () => [{ id: 'test-model' }],
}));

jest.mock('../../data/repositories/oaicompat-session-repo', () => ({
    OpenAICompatSessionRepository: jest.fn().mockImplementation(() => ({
        findByKeyForUser: jest.fn().mockResolvedValue(undefined),
        findByKeyForAnon: jest.fn().mockResolvedValue(undefined),
        tagKey: jest.fn().mockResolvedValue(undefined),
    })),
}));

import openaiCompatRouter, { setClusterManager } from '../../routes/openai-compat.routes';

const mkApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1', openaiCompatRouter);
    return app;
};

const send = () => request(mkApp())
    .post('/api/v1/chat/completions')
    .send({ model: 'test-model', messages: [{ role: 'user', content: '엑셀 파일 만들어줘' }] });

describe('openai-compat message.agent_tasks 확장', () => {
    let processChatSpy: jest.SpyInstance;

    beforeAll(() => {
        setClusterManager({} as unknown as ClusterManager);
    });

    afterEach(() => {
        processChatSpy.mockRestore();
    });

    it('이번 턴에 위임한 작업을 message.agent_tasks 로 동봉한다', async () => {
        const agentTasks = [
            { id: 't1', goal: '엑셀 파일', status: 'created' },
            { id: 't0', goal: '예전 작업', status: 'duplicate' },
        ];
        processChatSpy = jest.spyOn(ChatRequestHandler, 'processChat').mockResolvedValue({
            response: '백그라운드 작업으로 위임했습니다', sessionId: 's', model: 'test-model', agentTasks,
        } as never);
        const res = await send();
        expect(res.status).toBe(200);
        expect(res.body.choices[0].message.agent_tasks).toEqual(agentTasks);
    });

    it('위임한 작업이 없으면 필드를 생략한다', async () => {
        processChatSpy = jest.spyOn(ChatRequestHandler, 'processChat').mockResolvedValue({
            response: 'ok', sessionId: 's', model: 'test-model',
        } as never);
        const res = await send();
        expect(res.status).toBe(200);
        expect('agent_tasks' in res.body.choices[0].message).toBe(false);
    });
});
