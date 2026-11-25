/**
 * 확장 설치 Custom Agent 승인 (206, opt-in EXTENSION_AGENT_APPROVAL_REQUIRED, 2026-11-25) — 외부 저장소의 시스템 프롬프트가
 * 검토 없이 활성이 되던 결함. 옵션이 꺼져 있으면 모든 행이 approved 라 아래 필터는 종전 결과와 같다.
 *
 * 계약:
 *  - 실행·목록·공유 경로는 approval_status='approved' 만 본다(pending 은 채팅에 쓰일 수 없다).
 *  - 승인·거절은 소유자 본인의 pending 행만 바꾼다. 거절은 soft-delete + 이름 비키기.
 *  - 업데이트 시 같은 이름·같은 내용 지문의 에이전트만 종전 승인을 이어받는다.
 */
import type { Pool } from 'pg';
import { UserAgentRepository } from '../user-agent-repository';
import { UserExtensionRepository } from '../user-extension-repository';

function fakePool(rows: (sql: string, params: unknown[]) => unknown[] = () => []): { pool: Pool; calls: Array<{ sql: string; params: unknown[] }> } {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
        query: async (sql: string, params: unknown[] = []) => {
            const norm = sql.replace(/\s+/g, ' ').trim();
            calls.push({ sql: norm, params });
            const r = rows(norm, params);
            return { rows: r, rowCount: r.length };
        },
    } as unknown as Pool;
    return { pool, calls };
}

describe('UserAgentRepository — 승인 상태 필터', () => {
    it('실행 경로(getByIdVisibleToUser)·목록·공유 전환은 승인된 에이전트만 본다', async () => {
        const { pool, calls } = fakePool();
        const repo = new UserAgentRepository(pool);
        await repo.getByIdVisibleToUser('a1', 'u1');
        await repo.listVisibleToUser('u1', 'org1');
        await repo.setVisibility('a1', 'u1', 'shared');
        for (const c of calls) expect(c.sql).toContain("approval_status = 'approved'");
    });

    it('생성은 기본 approved, 확장 설치분은 pending 으로 넣는다', async () => {
        const { pool, calls } = fakePool(() => [{ id: 'x' }]);
        const repo = new UserAgentRepository(pool);
        await repo.create({ id: 'a1', userId: 'u1', name: 'n', systemPrompt: 'p' });
        await repo.create({ id: 'a2', userId: 'u1', name: 'm', systemPrompt: 'p', approvalStatus: 'pending' });
        expect(calls[0].params.at(-1)).toBe('approved');
        expect(calls[1].params.at(-1)).toBe('pending');
    });

    it('승인·거절은 소유자의 pending 행만 대상으로 하고, 거절은 이름을 비킨다', async () => {
        const { pool, calls } = fakePool(() => []);
        const repo = new UserAgentRepository(pool);
        expect(await repo.approve('a1', 'u1')).toBeUndefined();
        expect(await repo.reject('a1', 'u1')).toBe(false);
        for (const c of calls) {
            expect(c.sql).toContain('user_id = $2');
            expect(c.sql).toContain("approval_status = 'pending'");
            expect(c.params).toEqual(['a1', 'u1']);
        }
        expect(calls[1].sql).toContain('is_active = FALSE');
        expect(calls[1].sql).toContain("'-rejected-'");
    });

    it('승인 대기 목록·개수는 본인 것만', async () => {
        const { pool, calls } = fakePool((sql) => (sql.includes('COUNT') ? [{ count: '2' }] : []));
        const repo = new UserAgentRepository(pool);
        await repo.listPendingForUser('u1');
        expect(await repo.countPendingForUser('u1')).toBe(2);
        for (const c of calls) {
            expect(c.sql).toContain('user_id = $1');
            expect(c.sql).toContain("approval_status = 'pending'");
        }
    });
});

describe('UserExtensionRepository — Custom Agent 승인 이어받기', () => {
    it('스냅샷은 승인된 에이전트의 이름·내용 지문만', async () => {
        const { pool, calls } = fakePool(() => [{ name: 'ext-a', fingerprint: 'fp' }]);
        const snap = await new UserExtensionRepository(pool).snapshotApprovedAgents('ext1');
        expect(snap).toEqual([{ name: 'ext-a', fingerprint: 'fp' }]);
        expect(calls[0].sql).toContain("approval_status='approved'");
        expect(calls[0].sql).toContain('system_prompt');
    });

    it('지문 opt-in 이 아니면 같은 이름의 pending 을 지문 조건 없이 이어받는다', async () => {
        const { pool, calls } = fakePool((_sql, params) => [{ id: params[0] }]);
        const carried = await new UserExtensionRepository(pool).carryOverAgentApprovals(
            [{ agentId: 'a1', storedName: 'ext-a' }, { agentId: 'a2', storedName: 'ext-new' }],
            [{ name: 'ext-a', fingerprint: 'fp-a' }],
        );
        expect(carried).toEqual(['a1']);
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).not.toContain('sha256');
        expect(calls[0].params).toEqual(['a1']);
    });

    it('같은 이름이면 지문 일치 조건으로 UPDATE — 일치하는 행만 이어받는다 (requireSameContent)', async () => {
        // DB 가 지문 비교를 한다 — a-same 은 일치(행 반환), a-changed 는 불일치(0행)
        const { pool, calls } = fakePool((_sql, params) => (params[0] === 'a-same' ? [{ id: 'a-same' }] : []));
        const carried = await new UserExtensionRepository(pool).carryOverAgentApprovals(
            [
                { agentId: 'a-same', storedName: 'ext-a' },
                { agentId: 'a-changed', storedName: 'ext-b' },
                { agentId: 'a-new', storedName: 'ext-c' },
            ],
            [{ name: 'ext-a', fingerprint: 'fp-a' }, { name: 'ext-b', fingerprint: 'fp-b' }],
            { requireSameContent: true },
        );
        expect(carried).toEqual(['a-same']);
        // 새 이름(ext-c)은 질의조차 하지 않는다
        expect(calls).toHaveLength(2);
        for (const c of calls) {
            expect(c.sql).toContain("approval_status='pending'");
            expect(c.sql).toMatch(/= \$2/);
        }
        expect(calls[1].params).toEqual(['a-changed', 'fp-b']);
    });
});
