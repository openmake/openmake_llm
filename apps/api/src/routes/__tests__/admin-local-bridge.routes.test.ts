/**
 * 관리자 연결 기기 조회·강제 해제 (2026-10-05).
 * 관리자만 조회·해제할 수 있고(일반 사용자 403), 해제하면 그 소켓이 닫히며 감사 기록이 남는다.
 * 응답에는 폴더의 전체 경로를 싣지 않는다.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

jest.mock('../../auth/middleware', () => ({
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
        (req as unknown as { user: object }).user = { id: 'admin-1', role: req.header('x-test-role') ?? 'admin' };
        next();
    },
    requireAdmin: (req: Request & { user?: { role?: string } }, res: Response, next: NextFunction) => {
        if (req.user?.role === 'admin') next();
        else res.status(403).json({ success: false, error: { code: 'FORBIDDEN' } });
    },
}));

const mockLogAudit = jest.fn(async () => undefined);
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: mockLogAudit }) }));

const mockGetUserById = jest.fn(async (id: string) => ({ id, email: `${id}@example.com` }));
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getUserById: mockGetUserById }) }));

const ws1Close = jest.fn();
const devices = [
    {
        userId: 'u1', deviceId: 'd1', hostId: 'host-a', label: 'MacBook · work', folderName: '/Users/kim/projects/work',
        connectedAt: 1000, capabilities: new Set(['exec', 'browser']), ws: { close: ws1Close }, apiKeyId: 'secret-key-id',
    },
    { userId: 'u2', deviceId: 'd9', hostId: 'host-b', label: 'win', folderName: 'repo', connectedAt: 2000, capabilities: undefined, ws: { close: jest.fn() } },
];
const mockDisconnect = jest.fn((userId: string, deviceId: string, _reason: string) => userId === 'u1' && deviceId === 'd1');
jest.mock('../../services/local-bridge/registry', () => ({
    LEGACY_BRIDGE_KINDS: ['exec', 'read'],
    getLocalBridgeRegistry: () => ({
        listAllDevices: () => devices,
        disconnectDevice: (...a: [string, string, string]) => mockDisconnect(...a),
    }),
}));
jest.mock('../../config/local-bridge', () => ({ LOCAL_BRIDGE: { ENABLED: true } }));

import { adminLocalBridgeRouter } from '../admin-local-bridge.routes';

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/admin', adminLocalBridgeRouter);
    return a;
}

beforeEach(() => { mockLogAudit.mockClear(); mockDisconnect.mockClear(); });

describe('GET /api/admin/local-bridge/devices', () => {
    it('일반 사용자는 403', async () => {
        const res = await request(app()).get('/api/admin/local-bridge/devices').set('x-test-role', 'user');
        expect(res.status).toBe(403);
    });

    it('사용자별로 묶어 기기 목록을 돌려준다 — 폴더 전체 경로·키 id 는 싣지 않는다', async () => {
        const res = await request(app()).get('/api/admin/local-bridge/devices');
        expect(res.status).toBe(200);
        const data = res.body.data;
        expect(data.enabled).toBe(true);
        expect(data.users).toHaveLength(2);
        const u1 = data.users.find((u: { userId: string }) => u.userId === 'u1');
        expect(u1.email).toBe('u1@example.com');
        expect(u1.devices[0]).toEqual({
            deviceId: 'd1', hostId: 'host-a', label: 'MacBook · work', folderName: 'work',
            connectedAt: 1000, capabilities: ['browser', 'exec'],
        });
        const u2 = data.users.find((u: { userId: string }) => u.userId === 'u2');
        expect(u2.devices[0].capabilities).toEqual(['exec', 'read']);
        expect(JSON.stringify(res.body)).not.toContain('/Users/kim');
        expect(JSON.stringify(res.body)).not.toContain('secret-key-id');
    });
});

describe('POST /api/admin/local-bridge/devices/:deviceId/disconnect', () => {
    it('일반 사용자는 403', async () => {
        const res = await request(app()).post('/api/admin/local-bridge/devices/d1/disconnect').set('x-test-role', 'user').send({ userId: 'u1' });
        expect(res.status).toBe(403);
        expect(mockDisconnect).not.toHaveBeenCalled();
    });

    it('userId 가 없으면 400', async () => {
        const res = await request(app()).post('/api/admin/local-bridge/devices/d1/disconnect').send({});
        expect(res.status).toBe(400);
    });

    it('연결을 닫고 감사 기록을 남긴다', async () => {
        const res = await request(app()).post('/api/admin/local-bridge/devices/d1/disconnect').send({ userId: 'u1' });
        expect(res.status).toBe(200);
        expect(mockDisconnect).toHaveBeenCalledWith('u1', 'd1', 'admin_disconnect');
        expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'local_bridge.device_disconnect', userId: 'admin-1', resourceType: 'local_bridge_device', resourceId: 'u1/d1',
        }));
    });

    it('없는 기기는 404 이고 감사 기록을 남기지 않는다', async () => {
        const res = await request(app()).post('/api/admin/local-bridge/devices/nope/disconnect').send({ userId: 'u1' });
        expect(res.status).toBe(404);
        expect(mockLogAudit).not.toHaveBeenCalled();
    });
});
