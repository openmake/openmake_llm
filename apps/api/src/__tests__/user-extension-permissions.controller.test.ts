/**
 * 확장 권한 라우트(controllers/user-extension-permissions.controller) — 무DB.
 * 저장소·감사는 mock, auth 는 요청마다 mockUser 를 주입한다.
 * 고정하는 것: 소유자/관리자 조회 범위, 재승인 승인값·네트워크 복원, 철회의 네트워크 제한, 409 경합, 감사 action.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

let mockUser: { id: string; role: 'admin' | 'user' } = { id: 'u-1', role: 'user' };
jest.mock('../auth', () => ({
    requireAuth: (req: Request & { user?: object }, _res: Response, next: NextFunction) => {
        req.user = { ...mockUser, userId: mockUser.id };
        next();
    },
}));
jest.mock('../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../data/user-manager', () => ({ isAdminRole: (role: unknown) => role === 'admin' }));

const mockGetByIdForUser = jest.fn();
jest.mock('../data/repositories/user-extension-repository', () => ({
    UserExtensionRepository: jest.fn().mockImplementation(() => ({ getByIdForUser: mockGetByIdForUser })),
}));
const mockSaveReview = jest.fn();
const mockRestore = jest.fn();
const mockRestrict = jest.fn();
jest.mock('../data/repositories/user-extension-permission-repository', () => ({
    UserExtensionPermissionRepository: jest.fn().mockImplementation(() => ({
        saveReviewIfRequestedUnchanged: mockSaveReview,
        restoreLinkedMcpNetwork: mockRestore,
        restrictLinkedMcpNetwork: mockRestrict,
    })),
}));
const mockLogAudit = jest.fn();
jest.mock('../services/AuditService', () => ({ getAuditService: () => ({ logAudit: mockLogAudit }) }));

import { createUserExtensionPermissionsController } from '../controllers/user-extension-permissions.controller';

const NET = 'network:internet';
const BASE = '/api/users/me/extensions/ext-1/permissions';

type Row = Record<string, unknown>;
function makeRow(over: Row = {}): Row {
    return {
        id: 'ext-1', user_id: 'u-1', name: 'pack', status: 'active',
        manifest: { components: { mcpServers: [{ name: 'cloud', error: 'PERMISSION_REVIEW_REQUIRED: network:internet 재승인 필요' }] } },
        permission_state: 'legacy_unreviewed', permissions_granted: null, permissions_requested: null,
        permissions_reviewed_at: null, permissions_reviewed_by: null,
        ...over,
    };
}
let currentRow: Row = makeRow();

function app(): express.Express {
    const a = express();
    a.use(express.json());
    a.use('/api/users/me/extensions', createUserExtensionPermissionsController());
    return a;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: 'u-1', role: 'user' };
    currentRow = makeRow();
    mockGetByIdForUser.mockImplementation(async () => currentRow);
    mockSaveReview.mockImplementation(async (_id: string, input: { state: string; granted: string[] | null; reviewedBy: string }) => ({
        ...currentRow,
        permission_state: input.state,
        permissions_granted: input.granted,
        permissions_reviewed_by: input.reviewedBy,
        permissions_reviewed_at: new Date('2026-10-16T00:00:00Z'),
    }));
    mockRestore.mockResolvedValue(2);
    mockRestrict.mockResolvedValue({ sandboxed: 1, disabled: 1 });
    mockLogAudit.mockResolvedValue(undefined);
});

describe('GET /:id/permissions', () => {
    it('소유자 — 레거시 상태·막힌 권한(없음)·설치에서 빠진 원격 서버', async () => {
        const res = await request(app()).get(BASE);
        expect(res.status).toBe(200);
        expect(res.body.data.permissions).toEqual({ state: 'legacy_unreviewed', granted: null, requested: null, blocked: [], reviewedAt: null });
        expect(res.body.data.excludedRemoteServers).toEqual(['cloud']);
        expect(mockGetByIdForUser).toHaveBeenCalledWith('ext-1', 'u-1', false);
    });

    it('남의 확장(조회 null)·제거된 확장은 404', async () => {
        mockGetByIdForUser.mockResolvedValueOnce(null);
        expect((await request(app()).get(BASE)).status).toBe(404);
        mockGetByIdForUser.mockResolvedValueOnce(makeRow({ status: 'removed' }));
        expect((await request(app()).get(BASE)).status).toBe(404);
    });

    it('관리자는 남의 확장도 조회한다(isAdmin=true)', async () => {
        mockUser = { id: 'admin-1', role: 'admin' };
        await request(app()).get(BASE);
        expect(mockGetByIdForUser).toHaveBeenCalledWith('ext-1', 'admin-1', true);
    });
});

describe('POST /:id/permissions/approve', () => {
    it('레거시 → 레거시 묵시 권한(network)을 승인, 이미 열려 있어 복원 없음, 감사 기록', async () => {
        const res = await request(app()).post(`${BASE}/approve`).send({});
        expect(res.status).toBe(200);
        expect(mockSaveReview).toHaveBeenCalledWith('ext-1', {
            state: 'reviewed', granted: [NET], reviewedBy: 'u-1', expectedRequested: null,
        });
        expect(mockRestore).not.toHaveBeenCalled();
        expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'extension.permissions_approved', userId: 'u-1', resourceType: 'user_extension', resourceId: 'ext-1',
        }));
        expect(res.body.data.permissions.state).toBe('reviewed');
        expect(res.body.data.restoredServers).toBe(0);
    });

    it('재승인 필요(승인 [] · 요청 [network]) → network 승인, 권한으로 막은 stdio 복원', async () => {
        currentRow = makeRow({ permission_state: 'review_required', permissions_granted: [], permissions_requested: [NET] });
        const res = await request(app()).post(`${BASE}/approve`).send({});
        expect(res.status).toBe(200);
        expect(mockSaveReview).toHaveBeenCalledWith('ext-1', {
            state: 'reviewed', granted: [NET], reviewedBy: 'u-1', expectedRequested: [NET],
        });
        expect(mockRestore).toHaveBeenCalledWith('ext-1');
        expect(res.body.data).toMatchObject({ restoredServers: 2, excludedRemoteServers: ['cloud'] });
        expect(res.body.data.permissions).toMatchObject({ state: 'reviewed', granted: [NET], blocked: [] });
    });

    it('읽은 뒤 요청 권한이 바뀌었으면 409, 감사·MCP 변경 없음', async () => {
        mockSaveReview.mockResolvedValueOnce(null);
        const res = await request(app()).post(`${BASE}/approve`).send({});
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('CONFLICT');
        expect(mockLogAudit).not.toHaveBeenCalled();
        expect(mockRestore).not.toHaveBeenCalled();
    });

    it('남의 확장은 404 — 저장하지 않는다', async () => {
        mockGetByIdForUser.mockResolvedValueOnce(null);
        expect((await request(app()).post(`${BASE}/approve`).send({})).status).toBe(404);
        expect(mockSaveReview).not.toHaveBeenCalled();
    });
});

describe('POST /:id/permissions/revoke', () => {
    it('네트워크 철회는 연결된 MCP 서버를 막는다(review_required, 감사 기록)', async () => {
        currentRow = makeRow({ permission_state: 'reviewed', permissions_granted: [NET], permissions_requested: [NET] });
        const res = await request(app()).post(`${BASE}/revoke`).send({ permissions: [NET] });
        expect(res.status).toBe(200);
        expect(mockSaveReview).toHaveBeenCalledWith('ext-1', {
            state: 'review_required', granted: [], reviewedBy: 'u-1', expectedRequested: [NET],
        });
        expect(mockRestrict).toHaveBeenCalledWith('ext-1');
        expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'extension.permissions_revoked', resourceId: 'ext-1' }));
        expect(res.body.data.restricted).toEqual({ sandboxed: 1, disabled: 1 });
        expect(res.body.data.permissions).toMatchObject({ state: 'review_required', blocked: [NET] });
    });

    it('레거시에서 network 철회도 MCP 서버를 막는다(레거시는 열려 있었다)', async () => {
        const res = await request(app()).post(`${BASE}/revoke`).send({ permissions: [NET] });
        expect(res.status).toBe(200);
        expect(mockSaveReview).toHaveBeenCalledWith('ext-1', expect.objectContaining({ state: 'review_required', granted: [] }));
        expect(mockRestrict).toHaveBeenCalledWith('ext-1');
    });

    it('승인하지 않은 권한 철회는 멱등 no-op — 저장·MCP 변경·감사 없음, 200 에 현재 상태', async () => {
        currentRow = makeRow({
            permission_state: 'reviewed', permissions_granted: [NET], permissions_requested: [NET],
            permissions_reviewed_at: new Date('2026-10-01T00:00:00Z'), permissions_reviewed_by: 'admin-9',
        });
        const res = await request(app()).post(`${BASE}/revoke`).send({ permissions: ['database:addon'] });
        expect(res.status).toBe(200);
        expect(mockSaveReview).not.toHaveBeenCalled();
        expect(mockRestrict).not.toHaveBeenCalled();
        expect(mockLogAudit).not.toHaveBeenCalled();
        expect(res.body.data).toEqual({
            permissions: { state: 'reviewed', granted: [NET], requested: [NET], blocked: [], reviewedAt: '2026-10-01T00:00:00.000Z' },
            restricted: { sandboxed: 0, disabled: 0 },
        });
    });

    it('이미 network 가 철회된 상태에서 다시 철회(no-op)하면 MCP 제한을 한 번 더 건다 — 지난 제한 실패의 재시도', async () => {
        currentRow = makeRow({ permission_state: 'review_required', permissions_granted: [], permissions_requested: [NET] });
        const res = await request(app()).post(`${BASE}/revoke`).send({ permissions: [NET] });
        expect(res.status).toBe(200);
        expect(mockSaveReview).not.toHaveBeenCalled();
        expect(mockLogAudit).not.toHaveBeenCalled();
        expect(mockRestrict).toHaveBeenCalledWith('ext-1');
        expect(res.body.data.restricted).toEqual({ sandboxed: 1, disabled: 1 });
    });

    it('어휘 밖 권한·빈 목록은 400, 저장하지 않는다', async () => {
        expect((await request(app()).post(`${BASE}/revoke`).send({ permissions: ['files:read'] })).status).toBe(400);
        expect((await request(app()).post(`${BASE}/revoke`).send({ permissions: [] })).status).toBe(400);
        expect(mockSaveReview).not.toHaveBeenCalled();
    });

    it('읽은 뒤 요청 권한이 바뀌었으면 409', async () => {
        currentRow = makeRow({ permission_state: 'reviewed', permissions_granted: [NET], permissions_requested: [NET] });
        mockSaveReview.mockResolvedValueOnce(null);
        expect((await request(app()).post(`${BASE}/revoke`).send({ permissions: [NET] })).status).toBe(409);
        expect(mockRestrict).not.toHaveBeenCalled();
    });
});
