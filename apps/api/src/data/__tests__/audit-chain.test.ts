/**
 * 감사 해시 체인(205) — 기록·검증 PURE 규칙과 보존 정리와의 정합.
 *  - 정상 체인은 ok, 내용 변경은 content, 행 삭제는 gap, 행 바꿔치기는 link 로 잡는다.
 *  - PII 익명화(ip·user_agent·details.actor 삭제)와 JSONB 키 순서 변경은 체인을 깨지 않는다.
 *  - 사용자 삭제(FK SET NULL)로 user_id 가 비면 user_erased 로 따로 센다(ok 는 유지).
 *  - 보존 기간에 지워지는 감사 종류는 체인에 넣지 않는다 — db-retention·task-retention 의 DELETE 조건과 목록이 한 쌍이다.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
    auditContentString, computeAuditRowHash, insertAuditRow, isAuditChainable, normalizeAuditDetails,
    verifyAuditChainRows, readAndVerifyAuditChain, type AuditChainRow, type AuditQueryClient,
} from '../audit-chain';
import { AUDIT_CHAIN, AUDIT_CHAIN_EXCLUDED_ACTIONS, AUDIT_CHAIN_EXCLUDED_RESOURCE_TYPES } from '../../config/audit-chain';

/** audit_logs 를 흉내 내는 메모리 클라이언트 — insertAuditRow 가 쓰는 SQL 4종만 안다. */
function fakeAuditTable(): AuditQueryClient & { rows: AuditChainRow[]; sql: string[] } {
    const rows: AuditChainRow[] = [];
    const sql: string[] = [];
    let id = 0;
    return {
        rows, sql,
        query: async (q: string, p: unknown[] = []) => {
            sql.push(q.trim().split(/\s+/).slice(0, 2).join(' '));
            if (q.includes('pg_advisory_xact_lock')) return { rows: [] };
            if (q.startsWith('SELECT chain_seq, row_hash FROM audit_logs WHERE chain_seq IS NOT NULL')) {
                const chained = rows.filter((r) => r.chain_seq !== null).sort((a, b) => Number(b.chain_seq) - Number(a.chain_seq));
                return { rows: chained.slice(0, 1) };
            }
            if (q.startsWith('SELECT id, chain_seq')) {
                const [from, limit] = p as [number, number];
                return { rows: rows.filter((r) => r.chain_seq !== null && Number(r.chain_seq) >= from)
                    .sort((a, b) => Number(a.chain_seq) - Number(b.chain_seq)).slice(0, limit) };
            }
            if (q.startsWith('SELECT chain_seq, row_hash FROM audit_logs WHERE chain_seq = $1')) {
                return { rows: rows.filter((r) => Number(r.chain_seq) === p[0]) };
            }
            if (q.startsWith('INSERT INTO audit_logs')) {
                const chained = p.length > 7;
                rows.push({
                    id: ++id, action: p[0] as string, user_id: p[1] as string | null, resource_type: p[2] as string | null,
                    resource_id: p[3] as string | null, details: JSON.parse(p[4] as string),
                    timestamp: chained ? p[7] as Date : new Date(),
                    chain_seq: chained ? p[8] as number : (null as unknown as number),
                    prev_hash: chained ? p[9] as string : null, row_hash: chained ? p[10] as string : null,
                });
                return { rows: [] };
            }
            throw new Error(`unexpected SQL: ${q}`);
        },
    };
}

async function seedChain(n: number): Promise<ReturnType<typeof fakeAuditTable>> {
    const t = fakeAuditTable();
    for (let i = 0; i < n; i++) {
        await insertAuditRow(t, {
            action: 'mcp_tool_call', userId: `u${i % 2}`, resourceType: 'mcp_builtin_tool', resourceId: `tool_${i}`,
            details: { durationMs: i, actor: { email: `a${i}@x` }, nested: { b: 1, a: [1, 2] } }, ipAddress: '10.0.0.1', userAgent: 'ua',
        }, { chain: true });
    }
    return t;
}

const chained = (t: { rows: AuditChainRow[] }): AuditChainRow[] => t.rows.filter((r) => r.chain_seq !== null);

describe('감사 해시 체인 — 기록', () => {
    it('체인 대상이면 잠금 → 마지막 행 조회 → INSERT 순서로, 순번은 1부터 이어지고 첫 prev_hash 는 genesis', async () => {
        const t = await seedChain(3);
        expect(t.sql.slice(0, 3)).toEqual(['SELECT pg_advisory_xact_lock($1)', 'SELECT chain_seq,', 'INSERT INTO']);
        expect(t.rows.map((r) => r.chain_seq)).toEqual([1, 2, 3]);
        expect(t.rows[0].prev_hash).toBe(AUDIT_CHAIN.GENESIS);
        expect(t.rows[1].prev_hash).toBe(t.rows[0].row_hash);
        expect(t.rows[2].prev_hash).toBe(t.rows[1].row_hash);
    });

    it('체인을 끄면(기본) 종전 INSERT 1회 — 잠금·조회 없음, 체인 컬럼 NULL', async () => {
        const t = fakeAuditTable();
        const seq = await insertAuditRow(t, { action: 'mcp_tool_call', details: {} }, { chain: false });
        expect(seq).toBeNull();
        expect(t.sql).toEqual(['INSERT INTO']);
        expect(t.rows[0].chain_seq).toBeNull();
    });

    it('보존 기간에 지워지는 감사 종류는 체인이 켜져 있어도 체인 밖으로 기록한다', async () => {
        const t = fakeAuditTable();
        expect(await insertAuditRow(t, { action: 'login.succeeded' }, { chain: true })).toBeNull();
        expect(await insertAuditRow(t, { action: 'agent_task_local_create', resourceType: 'agent_task' }, { chain: true })).toBeNull();
        expect(await insertAuditRow(t, { action: 'user.register' }, { chain: true })).toBe(1);
        expect(t.sql.filter((s) => s === 'INSERT INTO')).toHaveLength(3);
    });

    it('기본 설정은 꺼짐(opt-in)', () => {
        expect(AUDIT_CHAIN.ENABLED).toBe(process.env.AUDIT_HASH_CHAIN_ENABLED === 'true');
    });
});

describe('감사 해시 체인 — 검증', () => {
    it('손대지 않은 체인은 ok, 문제 0건', async () => {
        const r = verifyAuditChainRows(chained(await seedChain(5)));
        expect(r).toMatchObject({ ok: true, checked: 5, firstSeq: 1, lastSeq: 5, counts: { gap: 0, link: 0, content: 0, user_erased: 0 } });
    });

    it('행 내용(details·action·resource)을 바꾸면 content 로 잡는다', async () => {
        const t = await seedChain(4);
        t.rows[1].details = { ...t.rows[1].details, durationMs: 9999 };
        t.rows[2].action = 'user.register';
        const r = verifyAuditChainRows(chained(t));
        expect(r.ok).toBe(false);
        expect(r.counts.content).toBe(2);
        expect(r.issues.map((i) => i.seq)).toEqual([2, 3]);
    });

    it('행을 지우면 gap(빠진 순번·개수)으로 잡는다', async () => {
        const t = await seedChain(5);
        const rows = chained(t).filter((r) => r.chain_seq !== 2 && r.chain_seq !== 3);
        const r = verifyAuditChainRows(rows);
        expect(r.ok).toBe(false);
        expect(r.issues).toEqual([{ kind: 'gap', seq: 2, missing: 2 }]);
        expect(r.counts.link).toBe(0); // 빠진 구간 뒤는 그 행의 prev_hash 로 다시 잇는다(중복 보고 없음)
    });

    it('해시까지 새로 계산해 바꾼 행도 다음 행과의 연결(link)이 끊겨 잡힌다', async () => {
        const t = await seedChain(3);
        const victim = t.rows[1];
        victim.details = { forged: true };
        victim.row_hash = computeAuditRowHash(victim.prev_hash as string, auditContentString({
            chainSeq: victim.chain_seq, timestamp: victim.timestamp, action: victim.action, userId: victim.user_id,
            resourceType: victim.resource_type, resourceId: victim.resource_id, details: victim.details,
        }));
        const r = verifyAuditChainRows(chained(t));
        expect(r.ok).toBe(false);
        expect(r.counts.content).toBe(0);
        expect(r.issues).toEqual([{ kind: 'link', seq: 3, id: t.rows[2].id }]);
    });

    it('PII 익명화(details.actor 삭제)와 JSONB 키 순서 변경은 체인을 깨지 않는다', async () => {
        const t = await seedChain(3);
        for (const r of t.rows) {
            const { actor: _actor, ...rest } = r.details as Record<string, unknown>;
            r.details = Object.fromEntries(Object.entries(rest).reverse());
        }
        expect(verifyAuditChainRows(chained(t)).ok).toBe(true);
    });

    it('사용자 삭제로 user_id 가 NULL 이 된 행은 user_erased 로 따로 세고 ok 는 유지한다', async () => {
        const t = await seedChain(3);
        t.rows[0].user_id = null;
        const r = verifyAuditChainRows(chained(t));
        expect(r).toMatchObject({ ok: true, counts: { user_erased: 1, content: 0 } });
    });

    it('중간 구간 검증은 직전 행의 해시를 기준점으로 쓴다 — 기준 행 바로 뒤의 바꿔치기도 잡는다', async () => {
        const t = await seedChain(6);
        expect((await readAndVerifyAuditChain(t, { fromSeq: 3, limit: 10 })).ok).toBe(true);
        t.rows[2].prev_hash = 'f'.repeat(64);
        const r = await readAndVerifyAuditChain(t, { fromSeq: 3, limit: 10 });
        expect(r.firstSeq).toBe(3);
        expect(r.counts.link).toBe(1);
    });

    it('검증 limit 은 VERIFY_MAX_ROWS 로 자른다', async () => {
        const t = await seedChain(2);
        const spy = jest.spyOn(t, 'query');
        await readAndVerifyAuditChain(t, { limit: AUDIT_CHAIN.VERIFY_MAX_ROWS * 10 });
        expect(spy.mock.calls[0][1]).toEqual([1, AUDIT_CHAIN.VERIFY_MAX_ROWS]);
    });
});

describe('감사 해시 체인 — 정규화', () => {
    it('details 는 저장 모양(JSON 왕복)으로 — undefined 키는 사라지고 actor 는 빠진다', () => {
        expect(normalizeAuditDetails({ a: 1, b: undefined, actor: { email: 'x' }, d: new Date('2026-01-01T00:00:00Z') }))
            .toEqual({ a: 1, d: '2026-01-01T00:00:00.000Z' });
    });

    it('내용 문자열은 순번 타입(문자열/숫자 — pg BIGINT 는 문자열로 온다)에 무관하다', () => {
        const base = { timestamp: new Date(0), action: 'a', details: {} };
        expect(auditContentString({ ...base, chainSeq: 7 })).toBe(auditContentString({ ...base, chainSeq: '7' }));
    });
});

describe('감사 해시 체인 — 보존 정리와의 정합', () => {
    const read = (rel: string): string => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

    it('db-retention 이 행을 지우는 action 은 전부 체인 제외 목록에 있다(빠지면 정리할 때마다 체인이 끊긴다)', () => {
        const src = read('data/db-retention.ts');
        const deleted = [...src.matchAll(/DELETE FROM audit_logs\s+WHERE action = '([^']+)'/g)].map((m) => m[1]);
        expect(deleted.length).toBeGreaterThan(0);
        for (const action of deleted) expect(AUDIT_CHAIN_EXCLUDED_ACTIONS).toContain(action);
        for (const action of AUDIT_CHAIN_EXCLUDED_ACTIONS) expect(isAuditChainable(action, null)).toBe(false);
    });

    it('task-retention 이 지우는 resource_type 은 체인 제외 목록에 있다', () => {
        const src = read('services/agent-task/task-retention.ts');
        const types = [...src.matchAll(/FROM audit_logs WHERE resource_type = '([^']+)'/g)].map((m) => m[1]);
        expect(types.length).toBeGreaterThan(0);
        for (const t of types) expect(AUDIT_CHAIN_EXCLUDED_RESOURCE_TYPES).toContain(t);
    });

    it('db-retention 의 PII 익명화가 details 에서 지우는 키는 해시에서 빠진다', () => {
        const src = read('data/db-retention.ts');
        const keys = [...src.matchAll(/UPDATE audit_logs[\s\S]*?details = COALESCE\(details, '\{\}'::jsonb\) - '([^']+)'/g)].map((m) => m[1]);
        expect(keys).toEqual(['actor']);
        expect(normalizeAuditDetails({ [keys[0]]: 1, keep: 2 })).toEqual({ keep: 2 });
    });
});
