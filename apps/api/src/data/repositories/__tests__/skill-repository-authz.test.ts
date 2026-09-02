/**
 * 스킬 본문 변경/삭제 권한 회귀 테스트 (2026-09-02 보안 리뷰 H1)
 *
 * 시스템 스킬(created_by NULL)은 skill_manifests.prompt_md 를 통해 전 사용자 프롬프트에 주입되므로
 * 관리자만 수정/삭제할 수 있어야 한다. 종전엔 아무 인증 사용자가 통과했다.
 */
import { Pool } from 'pg';
import { SkillRepository } from '../skill-repository';
import { assertSkillMutationAllowed } from '../skill-authz';
import { AuthorizationError } from '../../../utils/error-handler';

jest.mock('../../retry-wrapper', () => ({
    withRetry: (fn: () => unknown) => fn(),
}));

function makeMockPool() {
    return { query: jest.fn() } as unknown as Pool;
}

function skillRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        id: 'skill-1', name: 'Test', description: 'd', content: 'c', category: 'general',
        is_public: false, created_by: null, created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(), source_repo: null, source_path: null,
        status: 'active', manifest_meta: null, ...overrides,
    };
}

const user = { userId: 'user-1', userRole: 'user' };
const other = { userId: 'user-2', userRole: 'user' };
const admin = { userId: 'admin-1', userRole: 'admin' };

describe('assertSkillMutationAllowed', () => {
    it('시스템 스킬 — 일반 사용자는 403', () => {
        expect(() => assertSkillMutationAllowed(null, user)).toThrow(AuthorizationError);
        expect(() => assertSkillMutationAllowed(undefined, user)).toThrow(AuthorizationError);
    });
    it('시스템 스킬 — 관리자는 허용', () => {
        expect(() => assertSkillMutationAllowed(null, admin)).not.toThrow();
    });
    it('사용자 스킬 — 소유자·관리자 허용, 타인 403', () => {
        expect(() => assertSkillMutationAllowed('user-1', user)).not.toThrow();
        expect(() => assertSkillMutationAllowed('user-1', admin)).not.toThrow();
        expect(() => assertSkillMutationAllowed('user-1', other)).toThrow(AuthorizationError);
    });
});

describe('SkillRepository update/delete 권한 게이트', () => {
    let pool: Pool;
    let repo: SkillRepository;

    beforeEach(() => {
        pool = makeMockPool();
        repo = new SkillRepository(pool);
    });

    it('updateSkill — 일반 사용자가 시스템 스킬을 수정하면 403 이고 UPDATE 가 실행되지 않는다', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [skillRow({ created_by: null })] }); // getSkillById
        await expect(repo.updateSkill('skill-1', { content: 'evil' }, user)).rejects.toThrow(AuthorizationError);
        const sqls = (pool.query as jest.Mock).mock.calls.map((c) => String(c[0]));
        expect(sqls.some((q) => /UPDATE\s+agent_skills/i.test(q))).toBe(false);
    });

    it('deleteSkill — 일반 사용자가 시스템 스킬을 삭제하면 403 이고 DELETE 가 실행되지 않는다', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [skillRow({ created_by: null })] }); // getSkillById
        await expect(repo.deleteSkill('skill-1', user)).rejects.toThrow(AuthorizationError);
        const sqls = (pool.query as jest.Mock).mock.calls.map((c) => String(c[0]));
        expect(sqls.some((q) => /DELETE\s+FROM\s+agent_skills/i.test(q))).toBe(false);
    });

    it('deleteSkill — 관리자는 시스템 스킬을 삭제할 수 있다', async () => {
        (pool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [skillRow({ created_by: null })] }) // getSkillById
            .mockResolvedValue({ rows: [], rowCount: 1 }); // DELETE + 이후
        await expect(repo.deleteSkill('skill-1', admin)).resolves.toBe(true);
    });

    it('deleteSkill — 타인 사용자 스킬은 403', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [skillRow({ created_by: 'user-1' })] });
        await expect(repo.deleteSkill('skill-1', other)).rejects.toThrow(AuthorizationError);
    });

    it('updateSkill — actor 미전달(내부 시더 경로)은 종전대로 게이트 없음', async () => {
        (pool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [skillRow({ created_by: null })] }) // getSkillById
            .mockResolvedValue({ rows: [skillRow({ created_by: null, content: 'x' })], rowCount: 1 });
        await expect(repo.updateSkill('skill-1', { content: 'x' })).resolves.not.toBeNull();
    });
});
