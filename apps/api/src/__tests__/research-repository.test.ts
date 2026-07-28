/**
 * research-repository.test.ts
 * ResearchRepository 단위 테스트
 */

jest.mock('../data/retry-wrapper', () => ({
    withRetry: jest.fn((fn: () => unknown) => fn())
}));

import { ResearchRepository } from '../data/repositories/research-repository';
import { Pool } from 'pg';

function makePool(): jest.Mocked<Pool> {
    return {
        query: jest.fn(),
        connect: jest.fn()
    } as unknown as jest.Mocked<Pool>;
}

describe('ResearchRepository', () => {
    let repo: ResearchRepository;
    let pool: jest.Mocked<Pool>;

    beforeEach(() => {
        pool = makePool();
        repo = new ResearchRepository(pool);
    });

    describe('createResearchSession', () => {
        test('기본 depth로 세션 생성', async () => {
            (pool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 1 });

            await repo.createResearchSession({
                id: 'sess-1',
                userId: 'user-1',
                topic: 'AI 트렌드'
            });

            expect(pool.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO research_sessions'),
                ['sess-1', 'user-1', 'AI 트렌드', 'standard']
            );
        });

        test('custom depth 설정', async () => {
            (pool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 1 });

            await repo.createResearchSession({
                id: 'sess-2',
                topic: '블록체인',
                depth: 'deep'
            });

            expect(pool.query).toHaveBeenCalledWith(
                expect.anything(),
                ['sess-2', undefined, '블록체인', 'deep']
            );
        });
    });

    describe('getResearchSession', () => {
        test('세션 조회 성공', async () => {
            const mockRow = {
                id: 'sess-1',
                topic: 'AI',
                status: 'completed',
                key_findings: ['발견1'],
                sources: ['http://source1.com']
            };
            (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockRow] });

            const result = await repo.getResearchSession('sess-1');

            expect(result).toEqual(mockRow);
            expect(pool.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM research_sessions'),
                ['sess-1']
            );
        });

        test('없는 세션 → undefined 반환', async () => {
            (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            const result = await repo.getResearchSession('nonexistent');
            expect(result).toBeUndefined();
        });

        test('key_findings/sources null이면 빈 배열로 정규화', async () => {
            const mockRow = { id: 'sess-3', topic: '양자', key_findings: null, sources: null };
            (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockRow] });

            const result = await repo.getResearchSession('sess-3');
            expect(result?.key_findings).toEqual([]);
            expect(result?.sources).toEqual([]);
        });
    });

    describe('updateResearchSession', () => {
        test('status와 progress 업데이트', async () => {
            (pool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 1 });

            await repo.updateResearchSession('sess-1', {
                status: 'completed',
                progress: 100
            });

            const call = (pool.query as jest.Mock).mock.calls[0];
            expect(call[0]).toContain('UPDATE research_sessions');
            expect(call[0]).toContain('status = $');
            expect(call[0]).toContain('progress = $');
            expect(call[0]).toContain('completed_at = NOW()');
        });

        test('failed 상태도 completed_at 설정', async () => {
            (pool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 1 });

            await repo.updateResearchSession('sess-1', { status: 'failed' });

            const call = (pool.query as jest.Mock).mock.calls[0];
            expect(call[0]).toContain('completed_at = NOW()');
        });

        test('running 상태는 completed_at 설정 안 함', async () => {
            (pool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 1 });

            await repo.updateResearchSession('sess-1', { status: 'running' });

            const call = (pool.query as jest.Mock).mock.calls[0];
            expect(call[0]).not.toContain('completed_at = NOW()');
        });
    });

    describe('getResearchSteps', () => {
        test('세션 단계 목록 반환', async () => {
            const mockSteps = [
                { id: 1, session_id: 'sess-1', step_number: 1, sources: null },
                { id: 2, session_id: 'sess-1', step_number: 2, sources: ['src'] }
            ];
            (pool.query as jest.Mock).mockResolvedValueOnce({ rows: mockSteps });

            const result = await repo.getResearchSteps('sess-1');

            expect(result).toHaveLength(2);
            expect(result[0].sources).toEqual([]); // null → []
            expect(result[1].sources).toEqual(['src']);
        });
    });

    describe('getUserResearchSessions', () => {
        test('사용자 세션 목록 반환', async () => {
            const mockSessions = [
                { id: 's1', user_id: 'u1', key_findings: null, sources: null }
            ];
            (pool.query as jest.Mock).mockResolvedValueOnce({ rows: mockSessions });

            const result = await repo.getUserResearchSessions('u1');

            expect(result).toHaveLength(1);
            expect(result[0].key_findings).toEqual([]);
        });
    });

    describe('deleteSessionWithSteps', () => {
        test('트랜잭션으로 단계→세션 순서로 삭제', async () => {
            const mockClient = {
                query: jest.fn().mockResolvedValue({}),
                release: jest.fn()
            };
            (pool.connect as jest.Mock).mockResolvedValueOnce(mockClient);

            await repo.deleteSessionWithSteps('sess-del');

            const queries = mockClient.query.mock.calls.map((c: unknown[]) => c[0]);
            expect(queries[0]).toBe('BEGIN');
            expect(queries[1]).toContain('DELETE FROM research_steps');
            expect(queries[2]).toContain('DELETE FROM research_sessions');
            expect(queries[3]).toBe('COMMIT');
            expect(mockClient.release).toHaveBeenCalled();
        });

        test('오류 시 ROLLBACK 후 에러 재전파', async () => {
            const mockClient = {
                query: jest.fn()
                    .mockResolvedValueOnce({}) // BEGIN
                    .mockRejectedValueOnce(new Error('FK violation')), // DELETE steps
                release: jest.fn()
            };
            (pool.connect as jest.Mock).mockResolvedValueOnce(mockClient);

            await expect(repo.deleteSessionWithSteps('sess-err')).rejects.toThrow('FK violation');

            const queries = mockClient.query.mock.calls.map((c: unknown[]) => c[0]);
            expect(queries).toContain('ROLLBACK');
            expect(mockClient.release).toHaveBeenCalled();
        });
    });
});
