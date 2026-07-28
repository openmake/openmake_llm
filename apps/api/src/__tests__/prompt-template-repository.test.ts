import { Pool, PoolClient } from 'pg';
import { PromptTemplateRepository } from '../data/repositories/prompt-template-repository';

// retry-wrapper bypass — query() 내부에서 사용
jest.mock('../data/retry-wrapper', () => ({
    withRetry: (fn: () => unknown) => fn(),
}));

describe('PromptTemplateRepository', () => {
    let mockPool: jest.Mocked<Pool>;
    let mockClient: jest.Mocked<PoolClient>;
    let repo: PromptTemplateRepository;

    beforeEach(() => {
        mockClient = {
            query: jest.fn(),
            release: jest.fn(),
        } as unknown as jest.Mocked<PoolClient>;

        mockPool = {
            query: jest.fn(),
            connect: jest.fn().mockResolvedValue(mockClient),
        } as unknown as jest.Mocked<Pool>;

        repo = new PromptTemplateRepository(mockPool);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ── findActiveByName ──────────────────────────────────
    describe('findActiveByName', () => {
        it('returns the active template row', async () => {
            const row = {
                id: 'uuid-1',
                name: 'system.default',
                category: 'system',
                content: 'You are helpful.',
                language: 'ko',
                version: 3,
                is_active: true,
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-04-01T00:00:00Z',
            };
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [row] });

            const result = await repo.findActiveByName('system.default');

            expect(result?.id).toBe('uuid-1');
            expect(result?.is_active).toBe(true);
            expect(result?.version).toBe(3);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('WHERE name = $1 AND is_active = TRUE'),
                ['system.default']
            );
        });

        it('returns null when not found', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
            const result = await repo.findActiveByName('missing');
            expect(result).toBeNull();
        });
    });

    // ── findIdByName ──────────────────────────────────────
    describe('findIdByName', () => {
        it('returns id when present', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 'uuid-x' }] });
            await expect(repo.findIdByName('foo')).resolves.toBe('uuid-x');
        });

        it('returns null when absent', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
            await expect(repo.findIdByName('foo')).resolves.toBeNull();
        });
    });

    // ── listByCategory ────────────────────────────────────
    describe('listByCategory', () => {
        it('queries category with active filter and orders by name', async () => {
            const rows = [
                { id: '1', name: 'a', category: 'agent', content: 'x', language: 'ko', version: 1, is_active: true, created_at: 'd', updated_at: 'd' },
                { id: '2', name: 'b', category: 'agent', content: 'y', language: 'ko', version: 2, is_active: true, created_at: 'd', updated_at: 'd' },
            ];
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows });

            const result = await repo.listByCategory('agent');

            expect(result).toHaveLength(2);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('WHERE category = $1 AND is_active = TRUE'),
                ['agent']
            );
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('ORDER BY name ASC'),
                ['agent']
            );
        });
    });

    // ── findById ──────────────────────────────────────────
    describe('findById', () => {
        it('returns template by id (active or not)', async () => {
            const row = {
                id: 'uuid-2', name: 'x', category: 'system', content: 'c',
                language: 'ko', version: 1, is_active: false,
                created_at: 'd', updated_at: 'd',
            };
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [row] });
            const result = await repo.findById('uuid-2');
            expect(result?.is_active).toBe(false);
        });
    });

    // ── createTemplate ────────────────────────────────────
    describe('createTemplate', () => {
        it('inserts template + v1 version inside a transaction', async () => {
            const insertedRow = {
                id: 'new-uuid', name: 'p1', category: 'system', content: 'hello',
                language: 'ko', version: 1, is_active: true,
                created_at: 'd', updated_at: 'd',
            };
            (mockClient.query as jest.Mock)
                .mockResolvedValueOnce(undefined)                // BEGIN
                .mockResolvedValueOnce({ rows: [insertedRow] }) // INSERT prompt_templates
                .mockResolvedValueOnce(undefined)                // INSERT versions
                .mockResolvedValueOnce(undefined);               // COMMIT

            const result = await repo.createTemplate({
                name: 'p1',
                content: 'hello',
                changedBy: 'admin@example.com',
                changeReason: 'initial',
            });

            expect(result.id).toBe('new-uuid');
            expect(mockPool.connect).toHaveBeenCalledTimes(1);
            expect(mockClient.release).toHaveBeenCalledTimes(1);

            const calls = (mockClient.query as jest.Mock).mock.calls;
            expect(calls[0][0]).toBe('BEGIN');
            expect(calls[1][0]).toMatch(/INSERT INTO prompt_templates/);
            expect(calls[1][1]).toEqual(['p1', 'system', 'hello', 'ko']);
            expect(calls[2][0]).toMatch(/INSERT INTO prompt_template_versions/);
            expect(calls[2][1]).toEqual(['new-uuid', 'hello', 'admin@example.com', 'initial']);
            expect(calls[3][0]).toBe('COMMIT');
        });

        it('rolls back on insert failure', async () => {
            (mockClient.query as jest.Mock)
                .mockResolvedValueOnce(undefined) // BEGIN
                .mockRejectedValueOnce(new Error('unique violation'))
                .mockResolvedValueOnce(undefined); // ROLLBACK

            await expect(
                repo.createTemplate({ name: 'dup', content: 'x' })
            ).rejects.toThrow('unique violation');

            const calls = (mockClient.query as jest.Mock).mock.calls;
            expect(calls[0][0]).toBe('BEGIN');
            expect(calls[calls.length - 1][0]).toBe('ROLLBACK');
            expect(mockClient.release).toHaveBeenCalledTimes(1);
        });
    });

    // ── createVersion ─────────────────────────────────────
    describe('createVersion', () => {
        it('locks row, inserts next version, updates main, all in transaction', async () => {
            const updatedRow = {
                id: 'tpl-1', name: 'p1', category: 'system', content: 'v2-content',
                language: 'ko', version: 2, is_active: true,
                created_at: 'd', updated_at: 'd',
            };
            (mockClient.query as jest.Mock)
                .mockResolvedValueOnce(undefined)                          // BEGIN
                .mockResolvedValueOnce({ rows: [{ version: 1 }] })          // SELECT FOR UPDATE
                .mockResolvedValueOnce(undefined)                           // INSERT versions
                .mockResolvedValueOnce({ rows: [updatedRow] })              // UPDATE main
                .mockResolvedValueOnce(undefined);                          // COMMIT

            const result = await repo.createVersion({
                templateId: 'tpl-1',
                content: 'v2-content',
                changedBy: 'user-9',
                changeReason: 'reword',
            });

            expect(result.version).toBe(2);
            expect(result.content).toBe('v2-content');

            const calls = (mockClient.query as jest.Mock).mock.calls;
            expect(calls[0][0]).toBe('BEGIN');
            expect(calls[1][0]).toMatch(/SELECT version FROM prompt_templates WHERE id = \$1 FOR UPDATE/);
            expect(calls[1][1]).toEqual(['tpl-1']);
            expect(calls[2][0]).toMatch(/INSERT INTO prompt_template_versions/);
            expect(calls[2][1]).toEqual(['tpl-1', 2, 'v2-content', 'user-9', 'reword']);
            expect(calls[3][0]).toMatch(/UPDATE prompt_templates/);
            expect(calls[3][1]).toEqual(['v2-content', 2, 'tpl-1']);
            expect(calls[4][0]).toBe('COMMIT');

            expect(mockClient.release).toHaveBeenCalledTimes(1);
        });

        it('throws and rolls back when template not found', async () => {
            (mockClient.query as jest.Mock)
                .mockResolvedValueOnce(undefined)                  // BEGIN
                .mockResolvedValueOnce({ rows: [] })               // SELECT FOR UPDATE → empty
                .mockResolvedValueOnce(undefined);                 // ROLLBACK

            await expect(
                repo.createVersion({ templateId: 'missing', content: 'x' })
            ).rejects.toThrow('PromptTemplate not found: missing');

            const calls = (mockClient.query as jest.Mock).mock.calls;
            expect(calls[calls.length - 1][0]).toBe('ROLLBACK');
            expect(mockClient.release).toHaveBeenCalledTimes(1);
        });

        it('rolls back on UPDATE failure', async () => {
            (mockClient.query as jest.Mock)
                .mockResolvedValueOnce(undefined)                          // BEGIN
                .mockResolvedValueOnce({ rows: [{ version: 5 }] })          // lock
                .mockResolvedValueOnce(undefined)                           // INSERT versions
                .mockRejectedValueOnce(new Error('update failed'))          // UPDATE main fails
                .mockResolvedValueOnce(undefined);                          // ROLLBACK

            await expect(
                repo.createVersion({ templateId: 'tpl-1', content: 'next' })
            ).rejects.toThrow('update failed');

            expect(mockClient.release).toHaveBeenCalledTimes(1);
        });
    });

    // ── listVersions ──────────────────────────────────────
    describe('listVersions', () => {
        it('orders DESC and applies limit (clamped 1..500)', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
            await repo.listVersions('tpl-1', 10000);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('ORDER BY version DESC'),
                ['tpl-1', 500]
            );
        });

        it('clamps non-positive limit to 1', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
            await repo.listVersions('tpl-1', 0);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.any(String),
                ['tpl-1', 1]
            );
        });

        it('maps rows to PromptTemplateVersion', async () => {
            const row = {
                id: 'v-uuid', template_id: 'tpl-1', version: 7,
                content: 'body', changed_by: 'u1', changed_at: '2026-04-01T00:00:00Z',
                change_reason: 'tune',
            };
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [row] });

            const result = await repo.listVersions('tpl-1');
            expect(result[0]).toEqual({
                id: 'v-uuid',
                template_id: 'tpl-1',
                version: 7,
                content: 'body',
                changed_by: 'u1',
                changed_at: '2026-04-01T00:00:00Z',
                change_reason: 'tune',
            });
        });
    });

    // ── setActive ─────────────────────────────────────────
    describe('setActive', () => {
        it('returns true when row updated', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 1 });
            await expect(repo.setActive('tpl-1', false)).resolves.toBe(true);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE prompt_templates SET is_active = $1'),
                [false, 'tpl-1']
            );
        });

        it('returns false when no row matched', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 0 });
            await expect(repo.setActive('missing', true)).resolves.toBe(false);
        });
    });
});
