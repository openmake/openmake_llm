import { ApiKeyRepository } from '../data/repositories/api-key-repository';
import { Pool } from 'pg';

// 1. pg Pool을 jest.mock('../data/models/unified-database', ...)으로 mock
jest.mock('../data/models/unified-database', () => {
    const mockPool = {
        query: jest.fn(),
    };
    return {
        getPool: jest.fn(() => mockPool),
        getUnifiedDatabase: jest.fn(() => ({
            getPool: jest.fn(() => mockPool),
        })),
    };
});

// retry-wrapper mock
jest.mock('../data/retry-wrapper', () => ({
    withRetry: (fn: () => any) => fn(),
}));

describe('ApiKeyRepository', () => {
    let apiKeyRepository: ApiKeyRepository;
    let mockPool: jest.Mocked<Pool>;

    beforeEach(() => {
        mockPool = {
            query: jest.fn(),
        } as any;
        apiKeyRepository = new ApiKeyRepository(mockPool);
        jest.clearAllMocks();
    });

    describe('recordApiUsage', () => {
        it('should execute UPSERT query for api_usage', async () => {
            const date = '2024-03-20';
            const apiKeyId = 'key-123';
            const models = { 'gpt-4': 1 };
            
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 1 });

            await apiKeyRepository.recordApiUsage(date, apiKeyId, 10, 100, 1, 150, models);

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO api_usage'),
                [date, apiKeyId, 10, 100, 1, 150, JSON.stringify(models)]
            );
        });

        it('should throw error if query fails', async () => {
            (mockPool.query as jest.Mock).mockRejectedValueOnce(new Error('DB Error'));

            await expect(apiKeyRepository.recordApiUsage('2024-03-20', 'key-123', 0, 0, 0, 0, {}))
                .rejects.toThrow('DB Error');
        });
    });

    describe('getDailyUsage', () => {
        it('should return daily usage stats', async () => {
            const mockRows = [{ date: '2024-03-20', requests: 10 }];
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: mockRows });

            const result = await apiKeyRepository.getDailyUsage(7);

            expect(result).toEqual(mockRows);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT date, SUM(requests)'),
                [7]
            );
        });
    });

    describe('createApiKey', () => {
        it('should create and return a new API key', async () => {
            const params = {
                id: 'key-1',
                userId: 'user-1',
                keyHash: 'hash',
                keyPrefix: 'omk_',
                last4: '1234',
                name: 'test key'
            };
            const mockRow = { ...params, scopes: null, allowed_models: null, is_active: true };
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockRow] });

            const result = await apiKeyRepository.createApiKey(params);

            expect(result.id).toBe('key-1');
            expect(result.scopes).toEqual(['*']); // Default
            expect(result.allowed_models).toEqual(['*']); // Default
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO user_api_keys'),
                expect.arrayContaining(['key-1', 'user-1', 'hash', 'omk_', '1234', 'test key'])
            );
        });
    });

    describe('getApiKeyByHash', () => {
        it('should return API key if found and active', async () => {
            const mockRow = { id: 'key-1', key_hash: 'hash', is_active: true };
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockRow] });

            const result = await apiKeyRepository.getApiKeyByHash('hash');

            expect(result?.id).toBe('key-1');
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM user_api_keys WHERE key_hash = $1 AND is_active = TRUE'),
                ['hash']
            );
        });

        it('should return undefined if not found', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            const result = await apiKeyRepository.getApiKeyByHash('unknown');

            expect(result).toBeUndefined();
        });
    });

    describe('getApiKeyById', () => {
        it('should return API key by ID', async () => {
            const mockRow = { id: 'key-1', is_active: false };
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockRow] });

            const result = await apiKeyRepository.getApiKeyById('key-1');

            expect(result?.id).toBe('key-1');
            expect(result?.is_active).toBe(false);
        });
    });

    describe('listUserApiKeys', () => {
        it('should list active keys for user', async () => {
            const mockRows = [{ id: 'k1' }, { id: 'k2' }];
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: mockRows });

            const result = await apiKeyRepository.listUserApiKeys('user-1');

            expect(result).toHaveLength(2);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('WHERE user_id = $1 AND is_active = TRUE'),
                ['user-1']
            );
        });

        it('should include inactive keys if requested', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            await apiKeyRepository.listUserApiKeys('user-1', { includeInactive: true });

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.not.stringContaining('AND is_active = TRUE'),
                ['user-1']
            );
        });

        it('should apply limit and offset', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            await apiKeyRepository.listUserApiKeys('user-1', { limit: 10, offset: 5 });

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('LIMIT $2 OFFSET $3'),
                ['user-1', 10, 5]
            );
        });
    });

    describe('updateApiKey', () => {
        it('should update and return the key', async () => {
            const updates = { name: 'new name', isActive: false };
            const mockRow = { id: 'key-1', name: 'new name', is_active: false };
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockRow] });

            const result = await apiKeyRepository.updateApiKey('key-1', updates);

            expect(result?.name).toBe('new name');
            expect(result?.is_active).toBe(false);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE user_api_keys SET updated_at = NOW(), name = $1, is_active = $2 WHERE id = $3'),
                ['new name', false, 'key-1']
            );
        });

        it('should return undefined if key to update does not exist', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            const result = await apiKeyRepository.updateApiKey('none', { name: 'test' });

            expect(result).toBeUndefined();
        });
    });

    describe('deleteApiKey', () => {
        it('should return true if deletion successful', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 1 });

            const result = await apiKeyRepository.deleteApiKey('key-1');

            expect(result).toBe(true);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM user_api_keys WHERE id = $1'),
                ['key-1']
            );
        });

        it('should return false if nothing deleted', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 0 });

            const result = await apiKeyRepository.deleteApiKey('none');

            expect(result).toBe(false);
        });
    });

    describe('rotateApiKey', () => {
        it('should update key hash and last4', async () => {
            const mockRow = { id: 'key-1', key_hash: 'new-hash', last_4: '5678' };
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockRow] });

            const result = await apiKeyRepository.rotateApiKey('key-1', 'new-hash', '5678');

            expect(result?.key_hash).toBe('new-hash');
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE user_api_keys'),
                ['new-hash', '5678', 'key-1']
            );
        });
    });

    describe('recordApiKeyUsage', () => {
        it('should increment requests and tokens', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 1 });

            await apiKeyRepository.recordApiKeyUsage('key-1', 100);

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('total_requests'),
                [100, 'key-1']
            );
        });
    });

    describe('getApiKeyUsageStats', () => {
        it('should return usage stats', async () => {
            const mockRow = { total_requests: 5, total_tokens: 500, last_used_at: '2024-03-20' };
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockRow] });

            const result = await apiKeyRepository.getApiKeyUsageStats('key-1');

            expect(result).toEqual({
                totalRequests: 5,
                totalTokens: 500,
                lastUsedAt: '2024-03-20'
            });
        });

        it('should return undefined if key not found', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            const result = await apiKeyRepository.getApiKeyUsageStats('none');

            expect(result).toBeUndefined();
        });
    });

    describe('countUserApiKeys', () => {
        it('should return the count of active keys', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ count: '3' }] });

            const result = await apiKeyRepository.countUserApiKeys('user-1');

            expect(result).toBe(3);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT COUNT(*) as count FROM user_api_keys WHERE user_id = $1 AND is_active = TRUE'),
                ['user-1']
            );
        });
    });
});
