/**
 * 사전 등록 OAuth 클라이언트 관리자 API(155, 계획 R-3) — 관리자 게이트·secret write-only·감사 로그에 secret 미기록·검증.
 */
const views = new Map<string, Record<string, unknown>>();
const upsert = jest.fn(async (p: { catalogId: string; clientId: string; clientSecret?: string | null }) => {
    views.set(p.catalogId, { catalogId: p.catalogId, clientId: p.clientId, hasSecret: !!p.clientSecret, authorizationParams: {}, updatedAt: 'now' });
});
const logAudit = jest.fn(async (_e: unknown) => undefined);
jest.mock('../../auth', () => {
    const { requireAdmin } = jest.requireActual('../../auth/middleware');
    return {
        requireAuth: (req: { user?: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
            req.user = { id: '3', role: req.headers['x-test-role'] };
            next();
        },
        requireAdmin,
    };
});
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));
jest.mock('../../data/repositories/mcp-catalog-admin-repository', () => ({
    McpCatalogAdminRepository: jest.fn().mockImplementation(() => ({
        getCatalogTemplateForAdmin: async (id: string) => (id === 'mcp-github-remote' ? { id } : null),
    })),
}));
jest.mock('../../data/repositories/mcp-catalog-oauth-client-repository', () => ({
    McpCatalogOAuthClientRepository: jest.fn().mockImplementation(() => ({
        getView: async (id: string) => views.get(id),
        upsert: (p: never) => upsert(p),
        delete: async (id: string) => views.delete(id),
    })),
}));
jest.mock('../../config/mcp-oauth', () => ({ resolveMcpOAuthRedirectUrl: () => 'https://chat.example.com/api/mcp/oauth/callback' }));
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: (e: unknown) => logAudit(e) }) }));

import express from 'express';
import request from 'supertest';
import { mcpCatalogAdminRouter } from '../mcp-catalog-admin.routes';

const app = express();
app.use(express.json());
app.use('/api/admin/mcp', mcpCatalogAdminRouter);

beforeEach(() => { views.clear(); jest.clearAllMocks(); });

describe('/api/admin/mcp/catalog/:id/oauth-client', () => {
    it('관리자가 아니면 403', async () => {
        const res = await request(app).get('/api/admin/mcp/catalog/mcp-github-remote/oauth-client').set('x-test-role', 'user');
        expect(res.status).toBe(403);
    });

    it('저장 후 조회는 secret 원문 없이 hasSecret·콜백 URL 만 돌려주고, 감사 로그에도 secret 이 없다', async () => {
        const put = await request(app).put('/api/admin/mcp/catalog/mcp-github-remote/oauth-client').set('x-test-role', 'admin')
            .send({ clientId: 'Iv1.abc', clientSecret: 'super-secret-value', scope: 'repo read:org' });
        expect(put.status).toBe(200);
        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ catalogId: 'mcp-github-remote', clientSecret: 'super-secret-value', updatedBy: '3' }));
        const get = await request(app).get('/api/admin/mcp/catalog/mcp-github-remote/oauth-client').set('x-test-role', 'admin');
        expect(get.body.data).toEqual({
            client: { catalogId: 'mcp-github-remote', clientId: 'Iv1.abc', hasSecret: true, authorizationParams: {}, updatedAt: 'now' },
            redirectUri: 'https://chat.example.com/api/mcp/oauth/callback',
        });
        expect(JSON.stringify(get.body)).not.toContain('super-secret-value');
        expect(JSON.stringify(logAudit.mock.calls)).not.toContain('super-secret-value');
        expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'mcp_catalog.oauth_client_changed', details: { secret: 'set', hasScope: true } }));
    });

    it('없는 카탈로그는 404, 잘못된 인가 파라미터 키는 400', async () => {
        const missing = await request(app).put('/api/admin/mcp/catalog/nope/oauth-client').set('x-test-role', 'admin').send({ clientId: 'x' });
        expect(missing.status).toBe(404);
        const bad = await request(app).put('/api/admin/mcp/catalog/mcp-github-remote/oauth-client').set('x-test-role', 'admin')
            .send({ clientId: 'x', authorizationParams: { 'Redirect-URI': 'https://evil' } });
        expect(bad.status).toBe(400);
        expect(upsert).not.toHaveBeenCalled();
    });

    it('삭제는 등록이 있을 때만 200', async () => {
        views.set('mcp-github-remote', { clientId: 'x' });
        expect((await request(app).delete('/api/admin/mcp/catalog/mcp-github-remote/oauth-client').set('x-test-role', 'admin')).status).toBe(200);
        expect((await request(app).delete('/api/admin/mcp/catalog/mcp-github-remote/oauth-client').set('x-test-role', 'admin')).status).toBe(404);
    });
});
