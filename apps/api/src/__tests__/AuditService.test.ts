import { AuditService } from '../services/AuditService';
import { AUDIT_ACTIONS } from '../config/audit-actions';
import { createAuditSchema } from '../schemas/audit.schema';
import { getPool, getUnifiedDatabase } from '../data/models/unified-database';

// Mock dependencies
jest.mock('../data/models/unified-database', () => ({
    getPool: jest.fn(),
    getUnifiedDatabase: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
    createLogger: jest.fn(() => ({
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
    })),
}));

describe('AuditService', () => {
    let auditService: AuditService;
    let mockPool: any;
    let mockDb: any;

    beforeEach(() => {
        jest.clearAllMocks();
        
        mockPool = {
            query: jest.fn(),
        };
        (getPool as jest.Mock).mockReturnValue(mockPool);

        mockDb = {
            logAudit: jest.fn(),
        };
        (getUnifiedDatabase as jest.Mock).mockReturnValue(mockDb);

        auditService = new AuditService();
    });

    describe('getAuditLogs', () => {
        it('should fetch audit logs with filters and pagination', async () => {
            const mockLogs = [{ id: 1, action: 'login', timestamp: new Date() }];
            const mockCount = { rows: [{ cnt: '1' }] };
            const mockResult = { rows: mockLogs };

            mockPool.query
                .mockResolvedValueOnce(mockCount) // For the count query
                .mockResolvedValueOnce(mockResult); // For the logs query

            const filters = {
                action: 'login',
                limit: 10,
                offset: 0,
            };

            const result = await auditService.getAuditLogs(filters);

            expect(result.logs).toEqual(mockLogs);
            expect(result.total).toBe(1);
            expect(mockPool.query).toHaveBeenCalledTimes(2);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT COUNT(*) AS cnt FROM audit_logs WHERE action = $1'),
                ['login']
            );
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM audit_logs WHERE action = $1 ORDER BY timestamp DESC LIMIT $2 OFFSET $3'),
                ['login', 10, 0]
            );
        });

        it('should handle multiple filters correctly', async () => {
            mockPool.query
                .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
                .mockResolvedValueOnce({ rows: [] });

            const filters = {
                startDate: '2023-01-01',
                endDate: '2023-12-31',
                userId: 'user-123',
            };

            await auditService.getAuditLogs(filters);

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('WHERE timestamp >= $1 AND timestamp <= $2 AND user_id = $3'),
                ['2023-01-01', '2023-12-31', 'user-123']
            );
        });
    });

    describe('getDistinctActions', () => {
        it('레지스트리의 action 전부를 담고, DB 에만 있는 과거 action 도 함께 정렬해 돌려준다', async () => {
            // 'login' = 레지스트리 밖 과거 기록, 'user.deleted' = 레지스트리와 중복
            const mockRows = [{ action: 'login' }, { action: 'user.deleted' }];
            mockPool.query.mockResolvedValueOnce({ rows: mockRows });

            const actions = await auditService.getDistinctActions();

            expect(actions).toEqual([...new Set([...AUDIT_ACTIONS, 'login'])].sort());
            expect(actions.filter((a) => a === 'user.deleted')).toHaveLength(1);
            expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('SELECT DISTINCT action'));
        });

        it('한 번도 기록되지 않은 action 도 목록에 나온다', async () => {
            mockPool.query.mockResolvedValueOnce({ rows: [] });

            const actions = await auditService.getDistinctActions();

            expect(actions).toEqual([...AUDIT_ACTIONS]);
            expect(actions).toContain('user.role_changed');
        });
    });

    describe('getAuditStats', () => {
        it('should return audit statistics', async () => {
            const mockRows = [
                { action: 'login', count: 10 },
                { action: 'logout', count: 5 }
            ];
            mockPool.query.mockResolvedValueOnce({ rows: mockRows });

            const stats = await auditService.getAuditStats();

            expect(stats).toEqual([
                { action: 'login', count: 10 },
                { action: 'logout', count: 5 }
            ]);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('GROUP BY action'),
                []
            );
        });

        it('should apply date filters to stats', async () => {
            mockPool.query.mockResolvedValueOnce({ rows: [] });

            await auditService.getAuditStats('2023-01-01', '2023-01-31');

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('WHERE timestamp >= $1 AND timestamp <= $2'),
                ['2023-01-01', '2023-01-31']
            );
        });
    });

    describe('logAudit', () => {
        it('should call db.logAudit with correct parameters', async () => {
            const input = {
                action: 'artifact_export' as const,
                userId: 'user-1',
                resourceType: 'file',
                resourceId: 'file-123',
                details: { info: 'test' },
                ipAddress: '127.0.0.1',
                userAgent: 'test-agent'
            };

            await auditService.logAudit(input);

            expect(mockDb.logAudit).toHaveBeenCalledWith(input);
        });

        it('should throw error if db.logAudit fails', async () => {
            mockDb.logAudit.mockRejectedValueOnce(new Error('DB Error'));

            await expect(auditService.logAudit({ action: 'artifact_export' })).rejects.toThrow('DB Error');
        });
    });
});

describe('createAuditSchema (POST /api/audit)', () => {
    it('레지스트리에 등록된 action 은 받는다', () => {
        expect(createAuditSchema.safeParse({ action: 'user.deleted' }).success).toBe(true);
    });

    it('미등록 action 은 거절한다', () => {
        expect(createAuditSchema.safeParse({ action: 'user.delete' }).success).toBe(false);
        expect(createAuditSchema.safeParse({ action: '' }).success).toBe(false);
    });
});
