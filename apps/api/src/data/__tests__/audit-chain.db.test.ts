/**
 * 감사 해시 체인(205)·작업 단위 감사 조회 — **실제 Postgres**.
 *  - 동시 기록 20건이 advisory lock 아래에서 빈 순번·중복 없이 한 줄로 이어지고 검증이 ok 다.
 *  - JSONB 왕복(키 순서·타임스탬프 정밀도)·PII 익명화 UPDATE 뒤에도 체인이 유지되고, 행 수정·삭제는 잡힌다.
 *  - 작업 감사 저장소가 네 출처를 읽고, 같은 도구 호출의 인자 해시가 승인·스텝·감사 행에서 같다.
 * TEST_DATABASE_URL(격리 시험 DB) 이 없으면 skip. 만든 행은 이 파일의 태그로만 지운다.
 */
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { insertAuditRow, readAndVerifyAuditChain } from '../audit-chain';
import { withTransaction, type TransactionClient } from '../retry-wrapper';
import { AgentTaskAuditRepository } from '../repositories/agent-task-audit-repository';
import { hashToolArgs } from '../../utils/args-hash';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

describeOrSkip('감사 해시 체인 — 실제 Postgres (205)', () => {
    let pool: Pool;
    const tag = `ac-${randomUUID().slice(0, 8)}`;
    const userId = `${tag}-user`;
    const taskId = `${tag}-task`;

    const tx = <T>(fn: (c: TransactionClient) => Promise<T>): Promise<T> =>
        withTransaction(pool as unknown as { connect: () => Promise<TransactionClient> }, fn);

    /** 이 파일이 만든 체인 행의 첫 순번 — 검증은 여기서부터. */
    let firstSeq = 0;

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN, max: 8 });
        await pool.query(`INSERT INTO users (id, username, password_hash) VALUES ($1, $1, 'x')`, [userId]);
        await pool.query(`INSERT INTO agent_tasks (id, user_id, goal, status) VALUES ($1, $2, 'audit fixture', 'running')`, [taskId, userId]);
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM audit_logs WHERE details->>'tag' = $1`, [tag]);
        await pool.query('DELETE FROM agent_tasks WHERE id = $1', [taskId]);
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        await pool.end();
    });

    it('동시 기록 20건 — 순번이 빈틈·중복 없이 이어지고 검증 ok', async () => {
        const seqs = await Promise.all(Array.from({ length: 20 }, (_, i) => tx((c) => insertAuditRow(c, {
            action: 'mcp_tool_call', userId, resourceType: 'mcp_builtin_tool', resourceId: `tool_${i}`,
            details: { tag, i, z: { b: 2, a: 1 }, actor: { email: 'x@y' } }, ipAddress: '10.0.0.1', userAgent: 'ua',
        }, { chain: true }))));
        const sorted = (seqs as number[]).slice().sort((a, b) => a - b);
        firstSeq = sorted[0];
        expect(sorted).toEqual(Array.from({ length: 20 }, (_, i) => firstSeq + i));
        const r = await readAndVerifyAuditChain(pool, { fromSeq: firstSeq, limit: 20 });
        expect(r).toMatchObject({ ok: true, checked: 20, firstSeq, lastSeq: firstSeq + 19 });
    });

    it('PII 익명화 UPDATE(db-retention 7 과 같은 SQL 모양) 뒤에도 체인 유지', async () => {
        await pool.query(
            `UPDATE audit_logs SET ip_address = NULL, user_agent = NULL, details = COALESCE(details, '{}'::jsonb) - 'actor'
              WHERE details->>'tag' = $1`, [tag]);
        expect((await readAndVerifyAuditChain(pool, { fromSeq: firstSeq, limit: 20 })).ok).toBe(true);
    });

    it('행 내용을 바꾸면 content, 행을 지우면 gap 으로 잡힌다', async () => {
        await pool.query(`UPDATE audit_logs SET details = details || '{"i": 999}'::jsonb WHERE chain_seq = $1`, [firstSeq + 3]);
        await pool.query('DELETE FROM audit_logs WHERE chain_seq = $1', [firstSeq + 10]);
        const r = await readAndVerifyAuditChain(pool, { fromSeq: firstSeq, limit: 19 });
        expect(r.ok).toBe(false);
        expect(r.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'content', seq: firstSeq + 3 }),
            { kind: 'gap', seq: firstSeq + 10, missing: 1 },
        ]));
    });

    it('작업 감사 저장소 — 네 출처를 읽고 같은 호출의 인자 해시가 승인·스텝·감사에서 같다', async () => {
        const args = { path: 'out.txt', content: 'hello' };
        const h = hashToolArgs(args);
        await pool.query(`INSERT INTO agent_task_events (task_id, from_status, to_status) VALUES ($1, 'pending', 'running')`, [taskId]);
        await pool.query(
            `INSERT INTO agent_task_approvals (approval_id, task_id, user_id, tool_name, args, args_hash, status, expires_at, risk_class)
             VALUES ($1, $2, $3, 'write_file', $4::jsonb, $5, 'approved', NOW() + interval '1 hour', 'write')`,
            [`${tag}-ap`, taskId, userId, JSON.stringify(args), h]);
        await pool.query(
            // 실제 기록 모양(turn-response·tool-result 기록): 턴 단위 행은 호출 묶음 배열·콤마 결합 도구명, 호출 단위 인자는 tool_result 에.
            `INSERT INTO agent_task_steps (task_id, step_number, step_type, tool_name, tool_call_id, tool_args, content)
             VALUES ($1, 0, 'plan', 'write_file,web_search', NULL, $2::jsonb, 'secret-body'),
                    ($1, 1, 'tool_result', 'write_file', 'c1', $3::jsonb, 'Error: denied'),
                    ($1, 2, 'assistant', NULL, NULL, NULL, 'plain answer')`,
            [taskId, JSON.stringify([{ name: 'write_file', args }, { name: 'web_search', args: { query: 'q' } }]), JSON.stringify(args)]);
        await insertAuditRow(pool, {
            action: 'mcp_tool_call', userId, resourceType: 'mcp_builtin_tool', resourceId: 'write_file',
            details: { tag, taskId, argsHash: h, approvalPolicy: 'all' },
        }, { chain: false });

        const src = await new AgentTaskAuditRepository(pool).loadSources(taskId);
        expect(src.events).toHaveLength(1);
        expect(src.approvals[0]).toMatchObject({ tool_name: 'write_file', args_hash: h, risk_class: 'write' });
        expect(src.steps.map((s) => s.step_type)).toEqual(['plan', 'tool_result']); // assistant 본문 스텝은 뺀다
        expect(src.steps[0].args_hash).toBeNull(); // 턴 단위 배열 인자는 해시하지 않는다 — 호출 단위 해시는 tool_result
        expect(src.steps[1].args_hash).toBe(h);
        expect(src.steps[1].is_error).toBe(true);
        expect(src.auditLogs).toHaveLength(1);
        expect(src.auditLogs[0].details?.argsHash).toBe(h);
        expect(JSON.stringify(src)).not.toContain('secret-body');
        expect(JSON.stringify(src)).not.toContain('hello');
    });
});
