/**
 * GET /api/mcp/tools — 도구 목록 조회는 인증이 필요하다(인증 보강, 2026-11-07 점검).
 */
jest.mock('../../../auth', () => {
    const authed = (req: { headers: Record<string, string | undefined>; user?: unknown }) => {
        if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'], role: 'user' };
        return !!req.user;
    };
    return {
        requireAuth: (req: never, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
            if (authed(req)) return next();
            res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED' } });
        },
        optionalAuth: (req: never, _res: unknown, next: () => void) => { authed(req); next(); },
    };
});
const getToolList = jest.fn(() => [{ name: 'tool_a' }]);
jest.mock('../index', () => ({ getUnifiedMCPClient: () => ({ getToolList }) }));
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));
jest.mock('../data/mcp-server-repository', () => ({ McpServerRepository: jest.fn() }));
jest.mock('../data/mcp-catalog-repository', () => ({ McpCatalogRepository: jest.fn() }));
jest.mock('../data/mcp-oauth-repository', () => ({ McpOAuthRepository: jest.fn() }));
jest.mock('../lifecycle-supervisor', () => ({ getLifecycleSupervisor: () => null }));
jest.mock('../sandbox-bootstrap', () => ({ removeSandboxCacheVolume: jest.fn(async () => false) }));
jest.mock('../../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: jest.fn(async () => undefined) }) }));

import express from 'express';
import request from 'supertest';
import { mcpRouter } from '../routes/mcp.routes';

const app = express();
app.use(express.json());
app.use('/api/mcp', mcpRouter);

describe('GET /api/mcp/tools — 인증', () => {
    beforeEach(() => getToolList.mockClear());

    it('비인증이면 401 이고 도구 목록을 읽지 않는다', async () => {
        const res = await request(app).get('/api/mcp/tools');
        expect(res.status).toBe(401);
        expect(getToolList).not.toHaveBeenCalled();
    });

    it('인증 사용자는 200 으로 도구 목록을 받는다', async () => {
        const res = await request(app).get('/api/mcp/tools').set('x-test-user', 'u-1');
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ tools: [{ name: 'tool_a' }], total: 1 });
    });
});
