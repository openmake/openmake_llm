/**
 * User Agents 응답 계약 테스트 — 실핸들러(user-agents.controller GET /) 응답을
 * openapi.v1.json 으로 검증. 무DB — repository/auth mock.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { expectContract } from './contract-validator';

jest.mock('../../auth/middleware', () => ({
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
        req.user = {
            id: 'u1',
            email: 'riskpw@gmail.com',
            role: 'user',
            created_at: '2026-08-16T00:00:00.000Z',
            is_active: true,
        };
        next();
    },
}));

const agentRow = {
    id: 'a1',
    user_id: 'u1',
    name: '리서치 도우미',
    description: null,
    system_prompt: '너는 리서치 도우미다.',
    allowed_tools: ['web_search'],
    allowed_skills: [],
    icon: null,
    model: null,
    visibility: 'private',
    is_active: true,
    usage_count: 3,
    created_at: '2026-08-16T00:00:00.000Z',
    updated_at: '2026-08-16T01:00:00.000Z',
};

jest.mock('../../data/models/unified-database', () => ({
    getPool: () => ({}),
}));
jest.mock('../../data/repositories/user-agent-repository', () => ({
    UserAgentRepository: class {
        listVisibleToUser = jest.fn().mockResolvedValue([agentRow]);
    },
}));
jest.mock('../../services/model-assignment-validation', () => ({
    validateModelAssignment: jest.fn(),
}));
jest.mock('../../middlewares/validation', () => ({
    validate: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

import { createUserAgentsController } from '../../controllers/user-agents.controller';

describe('User Agents 응답 계약', () => {
    let app: express.Express;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/users/me/agents', createUserAgentsController());
    });

    test('GET /api/users/me/agents 200 (user_id 비노출 확인 포함)', async () => {
        const r = await request(app).get('/api/users/me/agents');
        expect(r.status).toBe(200);
        expect(r.body.data.agents).toHaveLength(1);
        expect(r.body.data.agents[0].user_id).toBeUndefined();
        expectContract('/api/users/me/agents', 'get', '200', r.body);
    });
});
