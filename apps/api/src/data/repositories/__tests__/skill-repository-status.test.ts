/**
 * SkillRepository.updateStatus + listDrafts 단위 테스트
 *
 * 검증 대상:
 *  - updateStatus: 소유권/admin 가드, draft↔active↔archived 전환
 *  - listDrafts: target 별 SQL 조건, 페이지네이션, userId 미입력 시 throw
 */
import { Pool } from 'pg';
import { SkillRepository } from '../skill-repository';

// retry-wrapper 가 withRetry 로 감싸므로 실제 retry 동작은 통과시키고 mock pool.query 만 어서트
jest.mock('../../retry-wrapper', () => ({
    withRetry: (fn: () => unknown) => fn(),
}));

function makeMockPool() {
    return { query: jest.fn() } as unknown as Pool;
}

function activeSkillRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        id: 'skill-1', name: 'Test', description: 'd', content: 'c', category: 'general',
        is_public: false, created_by: 'user-1', created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(), source_repo: null, source_path: null,
        status: 'draft', manifest_meta: null, ...overrides,
    };
}

describe('SkillRepository.updateStatus', () => {
    let pool: Pool;
    let repo: SkillRepository;

    beforeEach(() => {
        pool = makeMockPool();
        repo = new SkillRepository(pool);
    });

    it('user skill — 소유자 본인이 변경 가능 (draft → active)', async () => {
        (pool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [activeSkillRow({ created_by: 'user-1', status: 'draft' })] }) // getSkillById (pre-check)
            .mockResolvedValueOnce({ rows: [] })                                                          // UPDATE
            .mockResolvedValueOnce({ rows: [activeSkillRow({ created_by: 'user-1', status: 'active' })] }); // getSkillById (return)

        const result = await repo.updateStatus('skill-1', 'active', { userId: 'user-1', userRole: 'user' });
        expect(result?.status).toBe('active');
        expect((pool.query as jest.Mock).mock.calls[1][0]).toMatch(/UPDATE agent_skills SET status/);
    });

    it('user skill — 비소유자 user 가 시도하면 throw (assertResourceOwnerOrAdmin)', async () => {
        (pool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [activeSkillRow({ created_by: 'user-A', status: 'draft' })] });

        await expect(
            repo.updateStatus('skill-1', 'active', { userId: 'user-B', userRole: 'user' })
        ).rejects.toThrow();
        // UPDATE 가 호출되지 않음
        expect((pool.query as jest.Mock).mock.calls.length).toBe(1);
    });

    it('user skill — admin role 은 비소유자라도 변경 가능', async () => {
        (pool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [activeSkillRow({ created_by: 'user-A', status: 'draft' })] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [activeSkillRow({ created_by: 'user-A', status: 'active' })] });

        const result = await repo.updateStatus('skill-1', 'active', { userId: 'admin-1', userRole: 'admin' });
        expect(result?.status).toBe('active');
    });

    it('system skill (createdBy=null) — 비-admin actor 면 ADMIN_REQUIRED throw', async () => {
        (pool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [activeSkillRow({ created_by: null, status: 'draft' })] });

        await expect(
            repo.updateStatus('skill-sys', 'active', { userId: 'user-1', userRole: 'user' })
        ).rejects.toThrow(/ADMIN_REQUIRED/);
        expect((pool.query as jest.Mock).mock.calls.length).toBe(1);
    });

    it('system skill — admin actor 면 변경 가능', async () => {
        (pool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [activeSkillRow({ created_by: null, status: 'draft' })] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [activeSkillRow({ created_by: null, status: 'active' })] });

        const result = await repo.updateStatus('skill-sys', 'active', { userId: 'admin-1', userRole: 'admin' });
        expect(result?.status).toBe('active');
    });

    it('존재하지 않는 스킬 → null 반환', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
        const result = await repo.updateStatus('missing', 'active', { userId: 'user-1', userRole: 'user' });
        expect(result).toBeNull();
    });

    it('actor 미지정 시 소유권 체크 생략 (시스템 코드용)', async () => {
        (pool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [activeSkillRow({ created_by: null, status: 'draft' })] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [activeSkillRow({ created_by: null, status: 'archived' })] });

        const result = await repo.updateStatus('skill-sys', 'archived');
        expect(result?.status).toBe('archived');
    });
});

describe('SkillRepository.listDrafts', () => {
    let pool: Pool;
    let repo: SkillRepository;

    beforeEach(() => {
        pool = makeMockPool();
        repo = new SkillRepository(pool);
    });

    it('target=user 는 userId 필수 — 미지정 시 throw', async () => {
        await expect(repo.listDrafts({ target: 'user' })).rejects.toThrow(/userId/);
    });

    it('target=user — created_by 매칭 + status=draft 조건', async () => {
        (pool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [{ total: '2' }] })
            .mockResolvedValueOnce({ rows: [activeSkillRow({ status: 'draft' })] });

        const result = await repo.listDrafts({ target: 'user', userId: 'user-1', limit: 10 });
        expect(result.total).toBe(2);
        expect(result.drafts.length).toBe(1);

        const countSql = (pool.query as jest.Mock).mock.calls[0][0];
        const countParams = (pool.query as jest.Mock).mock.calls[0][1];
        expect(countSql).toMatch(/status = 'draft'/);
        expect(countSql).toMatch(/created_by = \$1/);
        expect(countParams).toEqual(['user-1']);
    });

    it('target=system — created_by IS NULL 조건', async () => {
        (pool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [{ total: '3' }] })
            .mockResolvedValueOnce({ rows: [] });

        await repo.listDrafts({ target: 'system' });
        const countSql = (pool.query as jest.Mock).mock.calls[0][0];
        expect(countSql).toMatch(/created_by IS NULL/);
        expect(countSql).toMatch(/status = 'draft'/);
    });

    it('target=all — created_by 필터 없음 (status=draft 만)', async () => {
        (pool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [{ total: '10' }] })
            .mockResolvedValueOnce({ rows: [] });

        await repo.listDrafts({ target: 'all' });
        const countSql = (pool.query as jest.Mock).mock.calls[0][0];
        expect(countSql).not.toMatch(/created_by/);
        expect(countSql).toMatch(/status = 'draft'/);
    });

    it('페이지네이션 — limit/offset 적용 + 상한 100 클램프', async () => {
        (pool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [{ total: '0' }] })
            .mockResolvedValueOnce({ rows: [] });

        const result = await repo.listDrafts({ target: 'user', userId: 'u', limit: 999, offset: 20 });
        expect(result.limit).toBe(100);  // 100 으로 클램프
        expect(result.offset).toBe(20);
    });
});
