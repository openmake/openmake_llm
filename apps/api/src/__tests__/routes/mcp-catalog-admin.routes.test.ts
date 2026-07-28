/**
 * mcp-catalog-admin.routes — admin CRUD 통합 테스트.
 *
 * 메인 DB 사용. unique SUFFIX 로 격리. requireAuth/requireAdmin 미들웨어를
 * mock 으로 우회 (req.user = admin 직접 주입).
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { Pool } from 'pg';

const CONN = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const SUFFIX = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// auth middleware 를 no-op 으로 mock — req.user = admin 주입
jest.mock('../../auth', () => ({
    requireAuth: (req: Request & { user?: object }, _res: Response, next: NextFunction) => {
        // req.user 가 setup 미들웨어에서 이미 주입돼 있으면 통과
        if (!req.user) {
            req.user = { id: 'test-admin', userId: 'test-admin', role: 'admin' };
        }
        next();
    },
    requireAdmin: (req: Request & { user?: { role?: string } }, res: Response, next: NextFunction) => {
        if (req.user?.role === 'admin') next();
        else res.status(403).json({ success: false, error: 'FORBIDDEN' });
    },
}));

// 동적 import — jest.mock 이 module 로드 전에 적용되도록
import { mcpCatalogAdminRouter } from '../../routes/mcp-catalog-admin.routes';

const describeOrSkip = CONN ? describe : describe.skip;

const TEST_ID_PREFIX = `mcp-test-${SUFFIX}`;
const VALID_PAYLOAD = {
    id: `${TEST_ID_PREFIX}-stdio`,
    display_name: `Test MCP ${SUFFIX}`,
    description: 'test',
    transport_type: 'stdio',
    command_template: 'npx -y @test/server',
    args_schema: {},
    env_schema: {},
    is_enabled: true,
};

describeOrSkip('mcp-catalog-admin.routes', () => {
    let pool: Pool;
    let app: express.Express;

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN });
        app = express();
        app.use(express.json());
        app.use('/api/admin/mcp', mcpCatalogAdminRouter);
    });

    beforeEach(async () => {
        await pool.query(`DELETE FROM mcp_server_catalog WHERE id LIKE $1`, [`${TEST_ID_PREFIX}%`]);
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM mcp_server_catalog WHERE id LIKE $1`, [`${TEST_ID_PREFIX}%`]);
        await pool.end();
    });

    test('POST /admin/mcp/catalog — golden create', async () => {
        const r = await request(app)
            .post('/api/admin/mcp/catalog')
            .send(VALID_PAYLOAD);
        expect(r.status).toBe(201);
        expect(r.body.success).toBe(true);
        expect(r.body.data.template.id).toBe(VALID_PAYLOAD.id);
        expect(r.body.data.template.is_enabled).toBe(true);
    });

    test('POST /admin/mcp/catalog — id 패턴 위반 400', async () => {
        const r = await request(app)
            .post('/api/admin/mcp/catalog')
            .send({ ...VALID_PAYLOAD, id: 'Invalid-UPPERCASE' });
        expect(r.status).toBe(400);
    });

    test('POST /admin/mcp/catalog — stdio 인데 command_template 없으면 400', async () => {
        const { command_template: _omit, ...rest } = VALID_PAYLOAD;
        void _omit;
        const r = await request(app)
            .post('/api/admin/mcp/catalog')
            .send(rest);
        expect(r.status).toBe(400);
    });

    test('POST /admin/mcp/catalog — duplicate id 409', async () => {
        await request(app).post('/api/admin/mcp/catalog').send(VALID_PAYLOAD);
        const r = await request(app).post('/api/admin/mcp/catalog').send(VALID_PAYLOAD);
        expect(r.status).toBe(409);
        expect(r.body.error).toBe('DUPLICATE_ID');
    });

    test('GET /admin/mcp/catalog — disabled 포함 전체', async () => {
        await request(app).post('/api/admin/mcp/catalog').send(VALID_PAYLOAD);
        await request(app).post('/api/admin/mcp/catalog').send({
            ...VALID_PAYLOAD,
            id: `${TEST_ID_PREFIX}-disabled`,
            is_enabled: false,
        });
        const r = await request(app).get('/api/admin/mcp/catalog');
        expect(r.status).toBe(200);
        expect(Array.isArray(r.body.data.templates)).toBe(true);
        const ours = r.body.data.templates.filter((t: { id: string }) => t.id.startsWith(TEST_ID_PREFIX));
        expect(ours.length).toBe(2);
    });

    test('GET /admin/mcp/catalog/:id', async () => {
        await request(app).post('/api/admin/mcp/catalog').send(VALID_PAYLOAD);
        const r = await request(app).get(`/api/admin/mcp/catalog/${VALID_PAYLOAD.id}`);
        expect(r.status).toBe(200);
        expect(r.body.data.template.id).toBe(VALID_PAYLOAD.id);
    });

    test('GET /admin/mcp/catalog/:id — 없으면 404', async () => {
        const r = await request(app).get(`/api/admin/mcp/catalog/nonexistent-${SUFFIX}`);
        expect(r.status).toBe(404);
    });

    test('PUT /admin/mcp/catalog/:id — partial update', async () => {
        await request(app).post('/api/admin/mcp/catalog').send(VALID_PAYLOAD);
        const r = await request(app)
            .put(`/api/admin/mcp/catalog/${VALID_PAYLOAD.id}`)
            .send({ display_name: 'Renamed', description: 'updated' });
        expect(r.status).toBe(200);
        expect(r.body.data.template.display_name).toBe('Renamed');
        expect(r.body.data.template.description).toBe('updated');
        expect(r.body.data.template.command_template).toBe(VALID_PAYLOAD.command_template);
    });

    test('PUT /admin/mcp/catalog/:id — is_enabled toggle', async () => {
        await request(app).post('/api/admin/mcp/catalog').send(VALID_PAYLOAD);
        const r = await request(app)
            .put(`/api/admin/mcp/catalog/${VALID_PAYLOAD.id}`)
            .send({ is_enabled: false });
        expect(r.status).toBe(200);
        expect(r.body.data.template.is_enabled).toBe(false);
    });

    test('PUT /admin/mcp/catalog/:id — 없으면 404', async () => {
        const r = await request(app)
            .put(`/api/admin/mcp/catalog/nonexistent-${SUFFIX}`)
            .send({ display_name: 'X' });
        expect(r.status).toBe(404);
    });

    test('DELETE /admin/mcp/catalog/:id', async () => {
        await request(app).post('/api/admin/mcp/catalog').send(VALID_PAYLOAD);
        const r = await request(app).delete(`/api/admin/mcp/catalog/${VALID_PAYLOAD.id}`);
        expect(r.status).toBe(200);
        expect(r.body.data.deleted).toBe(true);
        const after = await request(app).get(`/api/admin/mcp/catalog/${VALID_PAYLOAD.id}`);
        expect(after.status).toBe(404);
    });

    test('DELETE /admin/mcp/catalog/:id — 없으면 404', async () => {
        const r = await request(app).delete(`/api/admin/mcp/catalog/nonexistent-${SUFFIX}`);
        expect(r.status).toBe(404);
    });
});
