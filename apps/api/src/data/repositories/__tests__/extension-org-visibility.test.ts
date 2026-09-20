/**
 * 확장의 조직 공개 (166, S4 마찰 4) — 목록과 설치 판정이 같은 조건을 쓰고, org_id 는 organization 일 때만 남는다.
 */
import type { Pool } from 'pg';
import { UserExtensionRepository } from '../user-extension-repository';

jest.mock('../../retry-wrapper', () => ({ withRetry: (fn: () => unknown) => fn() }));

function fakePool(): { pool: Pool; calls: Array<{ sql: string; params: unknown[] }> } {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
        query: async (sql: string, params: unknown[] = []) => {
            calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
            return { rows: [], rowCount: 0 };
        },
    } as unknown as Pool;
    return { pool, calls };
}

describe('user_extensions 조직 공개', () => {
    it('갤러리 목록은 shared 전체 + 요청자가 멤버인 조직에 공개된 것만 낸다', async () => {
        const { pool, calls } = fakePool();
        await new UserExtensionRepository(pool).listShared(50, ['org-a', 'org-b']);
        expect(calls[0].sql).toContain("visibility='shared' OR (visibility='organization' AND org_id = ANY($2::text[]))");
        expect(calls[0].params).toEqual([50, ['org-a', 'org-b']]);
    });

    it('조직이 없는 사용자는 빈 배열이 넘어가 조직 공개분이 하나도 걸리지 않는다', async () => {
        const { pool, calls } = fakePool();
        await new UserExtensionRepository(pool).listShared();
        expect(calls[0].params[1]).toEqual([]);
    });

    it('설치 판정은 목록과 같은 조직 조건을 쓴다 — 목록에 안 보이는 남의 조직 확장을 id 로 설치할 수 없다', async () => {
        const { pool, calls } = fakePool();
        await new UserExtensionRepository(pool).getInstallableById('ext-1', 'u1', ['org-a']);
        expect(calls[0].sql).toContain("visibility='organization' AND org_id = ANY($3::text[])");
        expect(calls[0].params).toEqual(['ext-1', 'u1', ['org-a']]);
    });

    it('org_id 는 organization 일 때만 저장되고, 다른 공개범위로 바꾸면 지워진다', async () => {
        const { pool, calls } = fakePool();
        const repo = new UserExtensionRepository(pool);
        await repo.setVisibility('ext-1', 'u1', 'organization', 'org-a');
        await repo.setVisibility('ext-1', 'u1', 'shared', 'org-a');
        await repo.setVisibility('ext-1', 'u1', 'private');
        expect(calls.map((c) => c.params[3])).toEqual(['org-a', null, null]);
        // 소유자 한정 — WHERE 에 user_id 가 걸려 있다
        expect(calls[0].sql).toContain('user_id=$3');
    });
});
