/**
 * DELETE /api/users/me/extensions/:id — 확장 제거 뒤 회수한 MCP 서버의 떠 있는 연결을 닫는다(무DB).
 * 제거한 확장의 프로세스가 다음 정리(per_chat 종료·재시작)까지 계속 돌던 틈을 막는다.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

jest.mock('../auth/middleware', () => ({
    requireAuth: (req: Request & { user?: object }, _res: Response, next: NextFunction) => {
        req.user = { id: 'u-1', userId: 'u-1', role: 'user' };
        next();
    },
    requireAdmin: (_req: Request, res: Response) => { res.status(403).json({}); },
}));
jest.mock('../data/models/unified-database', () => ({ getPool: () => ({}) }));

const mockRemove = jest.fn();
jest.mock('../data/repositories/user-extension-repository', () => ({
    UserExtensionRepository: jest.fn().mockImplementation(() => ({ remove: mockRemove })),
}));
const mockRemoveInstallation = jest.fn();
jest.mock('../services/addon/addon-state', () => ({ removeExtensionInstallation: (...a: unknown[]) => mockRemoveInstallation(...a) }));
const mockRelease = jest.fn();
jest.mock('../services/extensions/release-linked-mcp', () => ({ releaseLinkedMcpServers: (...a: unknown[]) => mockRelease(...a) }));

import { createUserExtensionsController } from '../controllers/user-extensions.controller';

function app(): express.Express {
    const a = express();
    a.use(express.json());
    a.use('/api/users/me/extensions', createUserExtensionsController());
    return a;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockRemove.mockResolvedValue({ id: 'ext-1', user_id: 'u-1', name: 'pack', status: 'removed', source_hash: 'h' });
    mockRemoveInstallation.mockResolvedValue(undefined);
    mockRelease.mockResolvedValue(2);
});

describe('DELETE /api/users/me/extensions/:id', () => {
    it('제거한 뒤 그 확장의 MCP 연결을 소유자 기준으로 닫고 닫은 수를 돌려준다', async () => {
        const res = await request(app()).delete('/api/users/me/extensions/ext-1');
        expect(res.status).toBe(200);
        expect(mockRemove).toHaveBeenCalledWith('ext-1', 'u-1', false);
        expect(mockRelease).toHaveBeenCalledWith({}, 'ext-1', 'u-1');
        expect(mockRemove.mock.invocationCallOrder[0]).toBeLessThan(mockRelease.mock.invocationCallOrder[0]);
        expect(res.body.data.releasedServers).toBe(2);
        expect(res.body.data.extension.user_id).toBeUndefined();
    });

    it('없거나 이미 제거된 확장은 404 — 연결을 건드리지 않는다', async () => {
        mockRemove.mockResolvedValueOnce(null);
        const res = await request(app()).delete('/api/users/me/extensions/ext-x');
        expect(res.status).toBe(404);
        expect(mockRelease).not.toHaveBeenCalled();
    });
});
