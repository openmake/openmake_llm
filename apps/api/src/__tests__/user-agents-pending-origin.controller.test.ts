/**
 * 승인 대기 Custom Agent 목록(`GET /api/users/me/agents/pending`) — opt-in EXTENSION_AGENT_APPROVAL_REQUIRED 일 때만
 * 확장 출처(이름·원본·커밋)를 싣는 조회를 쓴다. 꺼져 있으면 종전 조회(옵션 없이) 그대로.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

jest.mock('../auth/middleware', () => ({
    requireAuth: (req: Request & { user?: object }, _res: Response, next: NextFunction) => {
        req.user = { id: 'u-1', userId: 'u-1', role: 'user' };
        next();
    },
}));
jest.mock('../data/models/unified-database', () => ({ getPool: () => ({}) }));
const mockListPending = jest.fn();
jest.mock('../data/repositories/user-agent-repository', () => ({
    UserAgentRepository: jest.fn().mockImplementation(() => ({ listPendingForUser: mockListPending })),
}));

import { createUserAgentsController } from '../controllers/user-agents.controller';

const ORIGINAL = process.env.EXTENSION_AGENT_APPROVAL_REQUIRED;
afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.EXTENSION_AGENT_APPROVAL_REQUIRED;
    else process.env.EXTENSION_AGENT_APPROVAL_REQUIRED = ORIGINAL;
    mockListPending.mockReset();
});

function app(): express.Express {
    const a = express();
    a.use('/api/users/me/agents', createUserAgentsController());
    return a;
}

describe('GET /api/users/me/agents/pending', () => {
    it('옵션이 꺼져 있으면 출처 없는 종전 조회', async () => {
        delete process.env.EXTENSION_AGENT_APPROVAL_REQUIRED;
        mockListPending.mockResolvedValue([]);
        const res = await request(app()).get('/api/users/me/agents/pending');
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ agents: [], total: 0 });
        expect(mockListPending).toHaveBeenCalledWith('u-1', { withOrigin: false });
    });

    it('옵션이 켜져 있으면 확장 출처를 싣고 user_id 는 빼고 돌려준다', async () => {
        process.env.EXTENSION_AGENT_APPROVAL_REQUIRED = 'true';
        mockListPending.mockResolvedValue([{
            id: 'a1', user_id: 'u-1', name: 'pack-reviewer', description: null, system_prompt: '리뷰어',
            extension_name: 'pack', extension_source_url: 'https://github.com/acme/pack', extension_source_ref: 'abc1234',
        }]);
        const res = await request(app()).get('/api/users/me/agents/pending');
        expect(mockListPending).toHaveBeenCalledWith('u-1', { withOrigin: true });
        expect(res.body.data.agents[0]).toEqual({
            id: 'a1', name: 'pack-reviewer', description: null, system_prompt: '리뷰어',
            extension_name: 'pack', extension_source_url: 'https://github.com/acme/pack', extension_source_ref: 'abc1234',
        });
    });
});
