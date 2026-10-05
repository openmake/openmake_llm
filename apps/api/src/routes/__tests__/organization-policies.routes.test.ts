/**
 * 조직 정책 저장 — BROWSER_SITE_POLICY 는 전역 시스템 설정과 같은 패턴 검증(@openmake/config browserSitePolicyProblems)을 받는다.
 * 잘못된 패턴이면 저장하지 않고, 어떤 항목이 왜 틀렸는지 응답에 싣는다.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

jest.mock('../../auth/middleware', () => ({
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
        (req as unknown as { user: object }).user = { id: 'admin-1', role: 'admin' };
        next();
    },
    requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../data/repositories/organization-repository', () => ({
    OrganizationRepository: jest.fn().mockImplementation(() => ({ get: async () => ({ id: 'org-1' }) })),
}));
const mockUpsert = jest.fn(async (orgId: string, key: string, value: unknown) => ({ orgId, key, value }));
jest.mock('../../data/repositories/organization-policy-repository', () => ({
    OrganizationPolicyRepository: jest.fn().mockImplementation(() => ({ list: async () => [], upsert: mockUpsert })),
}));
jest.mock('../../data/repositories/policy-history-repository', () => ({
    PolicyHistoryRepository: jest.fn().mockImplementation(() => ({ recordOrgPolicy: async () => undefined })),
}));
jest.mock('../../services/org/membership-cache', () => ({ membershipsFor: async () => [] }));
jest.mock('../../services/org/effective-policy', () => ({ clearOrgPolicyCache: jest.fn() }));
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: async () => undefined }) }));

import { adminOrganizationPoliciesRouter } from '../organization-policies.routes';

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/admin', adminOrganizationPoliciesRouter);
    return a;
}

const put = (value: unknown) =>
    request(app()).put('/api/admin/organizations/org-1/policies/BROWSER_SITE_POLICY').send({ value });

beforeEach(() => mockUpsert.mockClear());

describe('PUT /api/admin/organizations/:id/policies/BROWSER_SITE_POLICY', () => {
    it('올바른 패턴은 저장한다', async () => {
        const res = await put({ allow: ['groupware.example.co.kr', '*.intra.example.co.kr'], deny: [] });
        expect(res.status).toBe(200);
        expect(mockUpsert).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['넓은 와일드카드', '*.com', 'wildcard'],
        ['계정이 든 주소', 'user@a.com', 'userinfo'],
        ['다른 스킴', 'ftp://a.com', 'scheme'],
        ['한글 도메인', '그룹웨어.example.com', 'invalid'],
    ])('%s(%s)는 거절하고 항목·사유를 응답에 싣는다', async (_label, pattern, why) => {
        const res = await put({ allow: ['ok.example.com', pattern] });
        expect(res.status).toBe(400);
        expect(mockUpsert).not.toHaveBeenCalled();
        expect(res.body.error.message).toContain(`allow[1] "${pattern}": ${why}`);
        expect(res.body.error.details).toEqual({ problems: [`allow[1] "${pattern}": ${why}`] });
    });

    it('deny 목록도 같은 검증을 받는다', async () => {
        const res = await put({ deny: ['*.com'] });
        expect(res.status).toBe(400);
        expect(res.body.error.details.problems).toEqual(['deny[0] "*.com": wildcard']);
    });

    it('형태가 틀린 값은 종전처럼 형식 오류', async () => {
        const res = await put({ allow: 'a.com' });
        expect(res.status).toBe(400);
        expect(mockUpsert).not.toHaveBeenCalled();
    });
});
