/**
 * GDPR export — user_memories 가 현행 034 스키마 컬럼으로 조회되는지 + 카테고리 조회 실패가
 * 빈 배열로 위장되지 않고 `_meta.failedCategories` 로 드러나는지.
 * 배경: 2026-05-26 ~ 2026-09-07 user_memories 쿼리가 DROP 된 옛 컬럼을 조회해 매번 실패했고
 * catch 가 `[]` 로 바꿔 counts 0 으로 나갔다(조용한 실패). requireAuth/pool/audit mock, supertest.
 */
import express from 'express';
import request from 'supertest';

jest.mock('../../auth/middleware', () => ({
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
        (req as unknown as { user: unknown }).user = { userId: 'u1', role: 'user' }; next();
    },
}));
jest.mock('../../data/user-manager', () => ({ isAdminRole: () => false }));
const query = jest.fn();
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({ query }) }));
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }) }));

import { createExportController } from '../export.controller';

const app = express();
app.use('/api/users/me/export', createExportController());

const MEMORY_ROWS = [
    { id: 'm1', user_id: 'u1', content: '사용자는 TypeScript 를 선호한다', source: 'candidate', is_active: true },
    { id: 'm2', user_id: 'u1', content: '삭제된 기억', source: 'explicit', is_active: false },
];

/** 테이블별 응답 — failTable 에 해당하는 쿼리는 throw. */
function armPool(failTable?: string) {
    query.mockImplementation(async (sql: string) => {
        if (failTable && sql.includes(`FROM ${failTable}`)) throw new Error(`column does not exist (${failTable})`);
        if (sql.includes('FROM user_memories')) return { rows: MEMORY_ROWS };
        if (sql.includes('FROM users ')) return { rows: [{ id: 'u1', email: 'u1@x' }] };
        return { rows: [] };
    });
}

beforeEach(() => query.mockReset());

describe('export controller — user_memories', () => {
    it('034 스키마 컬럼(content/source/is_active)으로 조회하고 옛 컬럼을 참조하지 않는다', async () => {
        armPool();
        const res = await request(app).get('/api/users/me/export').expect(200);
        const call = query.mock.calls.find(([sql]) => String(sql).includes('FROM user_memories'));
        expect(call).toBeDefined();
        const [sql, params] = call as [string, unknown[]];
        expect(sql).toMatch(/content/);
        expect(sql).toMatch(/source/);
        expect(sql).toMatch(/is_active/);
        expect(sql).not.toMatch(/\b(category|key|value|importance)\b/);
        expect(sql).toMatch(/user_id\s*=\s*\$1/);
        expect(params).toEqual(['u1']);

        const body = JSON.parse(res.text);
        expect(body.userMemories).toHaveLength(2);
        expect(body._meta.counts.userMemories).toBe(2);
        expect(body._meta.failedCategories).toEqual([]);
        expect(body._meta.partial).toBe(false);
    });

    it('한 카테고리 조회가 실패하면 빈 배열로 계속하되 _meta 에 실패를 드러낸다', async () => {
        armPool('custom_agents');
        const res = await request(app).get('/api/users/me/export').expect(200);
        const body = JSON.parse(res.text);
        expect(body.customAgents).toEqual([]);
        expect(body._meta.failedCategories).toEqual(['custom_agents']);
        expect(body._meta.partial).toBe(true);
        // 다른 카테고리는 영향 없음
        expect(body.userMemories).toHaveLength(2);
    });

    it('user_memories 조회 실패도 조용히 0 으로 위장되지 않는다', async () => {
        armPool('user_memories');
        const res = await request(app).get('/api/users/me/export').expect(200);
        const body = JSON.parse(res.text);
        expect(body.userMemories).toEqual([]);
        expect(body._meta.counts.userMemories).toBe(0);
        expect(body._meta.failedCategories).toContain('user_memories');
        expect(body._meta.partial).toBe(true);
    });
});
