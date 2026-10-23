/**
 * 이어가기 후속의 원자적 생성·복구(#1473) — **실제 Postgres** 회귀. mock SQL 문자열 검사가 아니다.
 *
 * 크래시는 해당 문장이 끝난 직후 그 연결의 백엔드를 끊고(pg_terminate_backend — 열린 트랜잭션은 PG 가 되돌린다)
 * 이후 이 프로세스의 모든 질의를 실패시키는 것으로 재현한다(프로세스가 죽은 것과 DB 쪽 효과가 같다).
 *
 * 불변식: 부모의 continued_by_task_id 는 "없음" 이거나 "완전히 시드된 후속(체크포인트·fork·plan·실효 정책·실행기·소유권)" 만 가리킨다.
 * 복구: 커밋 뒤 디스패치 전 크래시는 R2(소유권 점검)가 한 곳에서만 회수하고, lease_until NULL(레거시·소유권 꺼짐) 후속은
 * R3 가 원자 claim 뒤 한 곳에서만 재디스패치한다. 살아 있는 다른 소유자·주차·종료 작업은 건드리지 않는다.
 *
 * TEST_DATABASE_URL(격리 시험 DB) 이 없으면 skip — 이 파일은 코어 스키마(db/init + db/migrations)를 그 DB 에 적용한다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Pool, type PoolClient, type QueryResult } from 'pg';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

// ── 실행 환경 대역: 모델·작업 공간·큐·실행기만 대역이고 DB 는 진짜다 ──
let currentPool: Pool;
const dispatchMock = jest.fn();
const executeMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../role-client', () => ({ chatTurnWithRoleFallback: jest.fn().mockResolvedValue({ content: '1. 다음 할 일' }) }));
jest.mock('../fork-workspace', () => ({ snapshotWorkspaceTurn: jest.fn().mockResolvedValue(undefined), turnSnapshotRef: (t: number) => `refs/omk/turn-${t}` }));
jest.mock('../task-queue', () => ({ dispatchAgentTask: (...a: unknown[]) => dispatchMock(...a), getAgentTaskQueue: () => ({ has: () => false }) }));
jest.mock('../../AgentTaskService', () => ({ AgentTaskService: Object.assign(jest.fn(() => ({ execute: (...a: unknown[]) => executeMock(...a) })), { isRunning: () => false }) }));
jest.mock('../../../monitoring/agent-task-alerts', () => ({ ...jest.requireActual('../../../monitoring/agent-task-alerts'), sendAgentTaskAlert: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../../data/models/unified-database', () => {
    const { AgentTaskRepository: Repo } = jest.requireActual('../../../data/repositories/agent-task-repository');
    const repo = () => new Repo(currentPool);
    return {
        getPool: () => currentPool,
        getUnifiedDatabase: () => ({
            createAgentTask: (p: unknown) => repo().createAgentTask(p),
            updateAgentTask: (id: string, u: unknown) => repo().updateAgentTask(id, u),
            getAgentTask: (id: string) => repo().getAgentTask(id),
            getAgentTaskSteps: (id: string) => repo().getAgentTaskSteps(id),
            getUserById: async () => ({ role: 'user' }),
        }),
    };
});

import { AGENT_TASK_LIMITS } from '../../../config/runtime-limits';
import { MigrationRunner } from '../../../data/migrations/runner';
import { AgentTaskLeaseRepository } from '../../../data/repositories/agent-task-lease-repository';
import { AgentTaskRepository } from '../../../data/repositories/agent-task-repository';
import { continueAsNewSegment } from '../continuation';
import { sweepExpiredTaskLeases } from '../boot-recovery';
import { leaseOwner } from '../task-lease';
import type { AgentTask } from '../../../data/models/unified-database.types';
import type { ChatMessage } from '../../../llm/types';

const limits = AGENT_TASK_LIMITS as unknown as Record<string, unknown>;
const originalLimits = { ...AGENT_TASK_LIMITS };
const DB_DIR = path.resolve(__dirname, '../../../../../../db');

/** 크래시 대역 — crashAfter 에 맞는 문장이 끝난 직후 그 연결을 끊고, 이후 질의는 전부 실패시킨다. */
class CrashingPool {
    crashed = false;
    constructor(private readonly real: Pool, private readonly admin: Pool, private readonly crashAfter?: RegExp) {}
    crash(): void { this.crashed = true; }
    private async run(sql: string, exec: () => Promise<QueryResult>, pid?: number): Promise<QueryResult> {
        if (this.crashed) throw new Error('process crashed');
        const r = await exec();
        if (this.crashAfter?.test(sql)) {
            this.crashed = true;
            if (pid) await this.admin.query('SELECT pg_terminate_backend($1)', [pid]);
            throw new Error('process crashed');
        }
        return r;
    }
    query = (sql: string, params?: unknown[]): Promise<QueryResult> => this.run(sql, () => this.real.query(sql, params));
    connect = async (): Promise<PoolClient> => {
        if (this.crashed) throw new Error('process crashed');
        const c = await this.real.connect();
        c.on('error', () => { /* 끊긴 백엔드 — 예상된 오류 */ });
        const pid = (c as unknown as { processID: number }).processID;
        return {
            query: (sql: string, params?: unknown[]) => this.run(sql, () => c.query(sql, params), pid),
            release: (err?: boolean | Error) => c.release(this.crashed ? true : err),
        } as unknown as PoolClient;
    };
    asPool(): Pool { return this as unknown as Pool; }
}

const conv = (): ChatMessage[] => [
    { role: 'system', content: 'sys' }, { role: 'user', content: '목표' },
    { role: 'assistant', content: '진행 중' },
];
const PLAN = { items: [{ title: '남은 일', status: 'pending' }] };
const BUDGET = { maxDurationMs: 10_000_000, maxTotalTokens: 10_000_000, maxSegments: 10, startedAt: 0 };

describeOrSkip('이어가기 원자성·복구 (실제 Postgres, #1473)', () => {
    let admin: Pool;
    let real: Pool;
    const userIds: string[] = [];

    beforeAll(async () => {
        admin = new Pool({ connectionString: CONN, max: 4 });
        admin.on('error', () => undefined);
        real = new Pool({ connectionString: CONN, max: 8 });
        real.on('error', () => undefined);
        const has = await admin.query(`SELECT to_regclass('public.agent_tasks') AS t`);
        if (!has.rows[0].t) {
            await admin.query(fs.readFileSync(path.join(DB_DIR, 'init/001-extensions.sql'), 'utf8'));
            await admin.query(fs.readFileSync(path.join(DB_DIR, 'init/002-schema.sql'), 'utf8'));
        }
        await new MigrationRunner(admin, { dir: path.join(DB_DIR, 'migrations') }).applyPending();
    }, 120_000);

    afterAll(async () => {
        Object.assign(limits, originalLimits);
        // 이 파일이 만든 사용자 id 로만 지운다(작업·이벤트는 FK CASCADE)
        if (admin && userIds.length) await admin.query('DELETE FROM users WHERE id = ANY($1::text[])', [userIds]);
        await real?.end();
        await admin?.end();
    });

    beforeEach(() => {
        Object.assign(limits, originalLimits, { LEASE_ENABLED: true, LEASE_MS: 60_000, RECOVERY_MAX_ATTEMPTS: 0 });
        dispatchMock.mockReset().mockResolvedValue('started');
        executeMock.mockClear();
        currentPool = real;
    });

    async function seedParent(over: Record<string, unknown> = {}): Promise<{ parent: AgentTask; userId: string }> {
        const userId = `b1473-${randomUUID()}`;
        userIds.push(userId);
        await admin.query(`INSERT INTO users (id, username, password_hash) VALUES ($1, $1, 'x')`, [userId]);
        const id = randomUUID();
        await admin.query(
            `INSERT INTO agent_tasks (id, user_id, goal, status, max_turns, chain_root_task_id, long_running, approval_policy, thinking_level,
                                      executor, device_id, folder_rel, plan)
             VALUES ($1, $2, '목표', 'running', 32, $1, $3, 'all', 'low', $4, $5, $6, $7)`,
            [id, userId, JSON.stringify(BUDGET), over.executor ?? 'sandbox', over.device_id ?? null, over.folder_rel ?? null, JSON.stringify(PLAN)]);
        const parent = (await admin.query<AgentTask>('SELECT * FROM agent_tasks WHERE id = $1', [id])).rows[0];
        return { parent, userId };
    }

    const input = (parent: AgentTask) => ({
        task: parent, root: parent, reason: 'turns' as const, conversation: conv(), turn: 7,
        roleState: {} as never, signal: new AbortController().signal, taskRuntime: null,
        userRole: 'user' as const, approvalPolicy: 'none' as const, thinkingLevel: 'high' as const, activeMs: 1_000, totalTokens: 100,
    });

    const row = async (id: string): Promise<AgentTask & Record<string, unknown>> =>
        (await admin.query('SELECT * FROM agent_tasks WHERE id = $1', [id])).rows[0];

    /** 불변식 — 부모 링크는 없거나 완전한 후속만 가리킨다. 후속(있으면)을 돌려준다. */
    async function assertParentLinkComplete(parentId: string, opts: { leased: boolean }): Promise<(AgentTask & Record<string, unknown>) | null> {
        const p = await row(parentId);
        const kids = (await admin.query('SELECT * FROM agent_tasks WHERE continued_from_task_id = $1', [parentId])).rows;
        if (!p.continued_by_task_id) {
            expect(kids).toHaveLength(0);
            return null;
        }
        expect(kids).toHaveLength(1);
        const s = kids[0];
        expect(s.id).toBe(p.continued_by_task_id);
        expect(s.status).toBe('pending');
        expect((s.checkpoint as { conversation?: unknown[] })?.conversation).toHaveLength(3);
        expect((s.checkpoint as { completedTurn?: number }).completedTurn).toBe(-1);
        expect(s.plan).toEqual(PLAN);
        expect(s.forked_from_task_id).toBe(parentId);
        expect(s.forked_from_turn).toBe(7);
        expect(s.approval_policy).toBe('none');
        expect(s.thinking_level).toBe('high');
        expect(s.chain_root_task_id).toBe(parentId);
        expect((s.continuation as { segmentIndex?: number }).segmentIndex).toBe(1);
        if (opts.leased) {
            expect(s.lease_owner).toBe(leaseOwner());
            expect(s.lease_until).not.toBeNull();
        } else {
            expect(s.lease_until).toBeNull();
        }
        return s;
    }

    describe('커밋 전 크래시는 아무것도 남기지 않는다', () => {
        it.each([
            ['부모 선점 직후', /SET continued_by_task_id = \$2/],
            ['후속 INSERT 직후', /^\s*INSERT INTO agent_tasks/],
            ['체크포인트 저장 직후', /checkpoint = \$/],
            ['fork 표시 직후', /forked_from_task_id = \$2/],
        ])('%s 크래시 → 부모 링크 없음·후속 행 없음(또는 완전한 후속)', async (_label, crashAfter) => {
            const { parent } = await seedParent();
            const crashing = new CrashingPool(real, admin, crashAfter);
            currentPool = crashing.asPool();
            dispatchMock.mockImplementation(async () => { crashing.crash(); throw new Error('process crashed'); });

            await continueAsNewSegment(input(parent));

            const s = await assertParentLinkComplete(parent.id, { leased: true });
            // 커밋 전 크래시면 후속이 없어야 한다 — 남았다면(커밋 후 크래시로 분류된 구현) 위에서 완전성까지 확인됐다
            if (crashAfter.source.startsWith('SET continued_by') || crashAfter.source.includes('INSERT')) expect(s).toBeNull();
        });
    });

    describe('커밋 뒤 디스패치 전 크래시 — R2 가 한 곳에서만 회수한다(lease ON)', () => {
        it('완전한 후속과 소유권이 남고, 소유권이 지나면 동시 점검 두 번 중 한 번만 재개한다', async () => {
            const { parent } = await seedParent();
            const crashing = new CrashingPool(real, admin);
            currentPool = crashing.asPool();
            dispatchMock.mockImplementationOnce(async () => { crashing.crash(); throw new Error('process crashed'); });

            await continueAsNewSegment(input(parent));
            const s = await assertParentLinkComplete(parent.id, { leased: true });
            expect(s).not.toBeNull();

            // 재시작된 프로세스 — 살아 있는 소유권 동안은 아무도 가져가지 않는다
            currentPool = real;
            dispatchMock.mockReset().mockResolvedValue('started');
            await sweepExpiredTaskLeases();
            expect(dispatchMock.mock.calls.filter((c) => c[0].taskId === s!.id)).toHaveLength(0);

            await admin.query(`UPDATE agent_tasks SET lease_until = NOW() - interval '1 second' WHERE id = $1`, [s!.id]);
            await Promise.all([sweepExpiredTaskLeases(), sweepExpiredTaskLeases()]);
            const mine = dispatchMock.mock.calls.filter((c) => c[0].taskId === s!.id);
            expect(mine).toHaveLength(1);
            await mine[0][0].run();
            const exec = executeMock.mock.calls.find((c) => c[0].taskId === s!.id)![0];
            expect(exec.resume.conversation).toHaveLength(3);
            expect(exec.resume.fromTurn).toBe(0);
            // 회수 claim 은 승인 정책·추론 수준을 지우지 않는다(execute 가 재개 때 행에서 되살린다)
            const after = await row(s!.id);
            expect(after).toMatchObject({ status: 'pending', approval_policy: 'none', thinking_level: 'high', lease_owner: leaseOwner() });
        });

        it('소유권 연장은 만료를 미루고, 다른 소유자의 연장은 거절된다', async () => {
            const { parent } = await seedParent();
            await continueAsNewSegment(input(parent));
            const s = (await assertParentLinkComplete(parent.id, { leased: true }))!;
            const leases = new AgentTaskLeaseRepository(real);
            await admin.query(`UPDATE agent_tasks SET lease_until = NOW() + interval '1 second' WHERE id = $1`, [s.id]);
            expect(await leases.renewLease(s.id, 'someone-else:9', 60_000)).toBe(false);
            expect(await leases.renewLease(s.id, leaseOwner(), 60_000)).toBe(true);
            expect(new Date((await row(s.id)).lease_until as string).getTime()).toBeGreaterThan(Date.now() + 30_000);
        });
    });

    describe('실효 정책·실행기·fork·plan 보존', () => {
        it('요청 override 정책과 로컬 실행기·기기·폴더가 후속 행에 그대로 저장된다', async () => {
            const { parent } = await seedParent({ executor: 'local', device_id: 'dev-1', folder_rel: 'proj/a' });
            const r = await continueAsNewSegment(input(parent));
            expect(r).toHaveProperty('successorId');
            const s = (await assertParentLinkComplete(parent.id, { leased: true }))!;
            expect(s).toMatchObject({ executor: 'local', device_id: 'dev-1', folder_rel: 'proj/a', user_id: parent.user_id, max_turns: 32 });
            expect(dispatchMock).toHaveBeenCalledTimes(1);
        });
    });

    describe('경합', () => {
        it('같은 부모를 두 실행이 동시에 이으면 후속은 하나, 디스패치도 한 번 — 진 쪽은 그 후속을 따른다', async () => {
            const { parent } = await seedParent();
            const [a, b] = await Promise.all([continueAsNewSegment(input(parent)), continueAsNewSegment(input(parent))]);
            const s = (await assertParentLinkComplete(parent.id, { leased: true }))!;
            expect(a).toEqual({ successorId: s.id });
            expect(b).toEqual({ successorId: s.id });
            expect(dispatchMock).toHaveBeenCalledTimes(1);
        });

        async function legacySuccessor(over: { lease_until?: string | null; lease_owner?: string | null; status?: string } = {}) {
            const { parent, userId } = await seedParent();
            const sid = randomUUID();
            await admin.query(
                `INSERT INTO agent_tasks (id, user_id, goal, status, max_turns, chain_root_task_id, continued_from_task_id, checkpoint, approval_policy, thinking_level,
                                          lease_owner, lease_until, updated_at)
                 VALUES ($1, $2, '목표', $3, 32, $4, $4, $5, 'none', 'high', $6, $7, NOW() - interval '1 hour')`,
                [sid, userId, over.status ?? 'pending', parent.id, JSON.stringify({ conversation: conv(), completedTurn: -1 }), over.lease_owner ?? null, over.lease_until ?? null]);
            await admin.query('UPDATE agent_tasks SET continued_by_task_id = $2 WHERE id = $1', [parent.id, sid]);
            return { parent: await row(parent.id) as AgentTask, sid };
        }

        it('레거시(lease NULL) 후속을 두 복구자가 동시에 따르면 재디스패치는 한 번 — lease ON 이면 claim 이 소유권을 쓴다', async () => {
            const { parent, sid } = await legacySuccessor();
            const [a, b] = await Promise.all([continueAsNewSegment(input(parent)), continueAsNewSegment(input(parent))]);
            expect(a).toEqual({ successorId: sid });
            expect(b).toEqual({ successorId: sid });
            expect(dispatchMock.mock.calls.filter((c) => c[0].taskId === sid)).toHaveLength(1);
            expect((await row(sid)).lease_owner).toBe(leaseOwner());
        });

        it('lease OFF: 후속은 소유권 없이 원자 저장되고, 커밋 뒤 크래시는 레거시 R3 가 한 번만 재디스패치한다(소유권 표식을 남기지 않는다)', async () => {
            limits.LEASE_ENABLED = false;
            const { parent } = await seedParent();
            const crashing = new CrashingPool(real, admin);
            currentPool = crashing.asPool();
            dispatchMock.mockImplementationOnce(async () => { crashing.crash(); throw new Error('process crashed'); });
            await continueAsNewSegment(input(parent));
            const s = (await assertParentLinkComplete(parent.id, { leased: false }))!;
            expect(s).not.toBeNull();

            currentPool = real;
            dispatchMock.mockReset().mockResolvedValue('started');
            // 꺼진 R2 는 아무것도 하지 않는다
            await sweepExpiredTaskLeases();
            expect(dispatchMock).not.toHaveBeenCalled();
            // 부모가 부팅 복구로 다시 돌아 이어가기에 닿는다 — 방금 만든 후속(갓 갱신)은 살아 있다고 본다
            const fresh = await row(parent.id) as AgentTask;
            expect(await continueAsNewSegment(input(fresh))).toEqual({ successorId: s.id });
            expect(dispatchMock).not.toHaveBeenCalled();
            // 오래된 레거시 상태가 되면 동시 두 실행 중 한 곳만 재디스패치한다
            await admin.query(`UPDATE agent_tasks SET updated_at = NOW() - interval '1 hour' WHERE id = $1`, [s.id]);
            const [a, b] = await Promise.all([continueAsNewSegment(input(fresh)), continueAsNewSegment(input(fresh))]);
            expect(a).toEqual({ successorId: s.id });
            expect(b).toEqual({ successorId: s.id });
            expect(dispatchMock.mock.calls.filter((c) => c[0].taskId === s.id)).toHaveLength(1);
            expect((await row(s.id)).lease_until).toBeNull();
        });

        it('non-null 만료 소유권 후속은 R3 가 직접 재디스패치하지 않고 R2 의 원자 takeover 에 맡긴다', async () => {
            const { parent, sid } = await legacySuccessor({ lease_owner: 'dead-host:0', lease_until: new Date(Date.now() - 1_000).toISOString() });
            expect(await continueAsNewSegment(input(parent))).toEqual({ successorId: sid });
            expect(dispatchMock).not.toHaveBeenCalled();
            await Promise.all([sweepExpiredTaskLeases(), sweepExpiredTaskLeases()]);
            expect(dispatchMock.mock.calls.filter((c) => c[0].taskId === sid)).toHaveLength(1);
        });
    });

    describe('제외 — 살아 있는 다른 소유자·주차·종료', () => {
        it('다른 소유자의 살아 있는 소유권: R3 는 따르기만 하고, R2·부팅 조회는 가져가지 않는다', async () => {
            const { parent, sid } = await (async () => {
                const { parent: p, userId } = await seedParent();
                const id = randomUUID();
                await admin.query(
                    `INSERT INTO agent_tasks (id, user_id, goal, status, max_turns, chain_root_task_id, continued_from_task_id, checkpoint, lease_owner, lease_until, updated_at)
                     VALUES ($1, $2, '목표', 'pending', 32, $3, $3, $4, 'other-host:1', NOW() + interval '5 minutes', NOW() - interval '1 hour')`,
                    [id, userId, p.id, JSON.stringify({ conversation: conv(), completedTurn: -1 })]);
                await admin.query('UPDATE agent_tasks SET continued_by_task_id = $2 WHERE id = $1', [p.id, id]);
                return { parent: await row(p.id) as AgentTask, sid: id };
            })();
            expect(await continueAsNewSegment(input(parent))).toEqual({ successorId: sid });
            await sweepExpiredTaskLeases();
            expect(dispatchMock.mock.calls.filter((c) => c[0].taskId === sid)).toHaveLength(0);
            const interrupted = await new AgentTaskRepository(real).getInterruptedAgentTasks(60_000, leaseOwner());
            expect(interrupted.some((t) => t.id === sid)).toBe(false);
            expect((await row(sid)).lease_owner).toBe('other-host:1');
        });

        it('주차(paused+주차 표식)·종료(completed·failed·cancelled) 작업은 만료 소유권이어도 R2 대상이 아니다', async () => {
            const { userId } = await seedParent();
            const ids: Record<string, string> = {};
            for (const status of ['paused', 'completed', 'failed', 'cancelled']) {
                ids[status] = randomUUID();
                await admin.query(
                    `INSERT INTO agent_tasks (id, user_id, goal, status, checkpoint, lease_owner, lease_until)
                     VALUES ($1, $2, '목표', $3, $4, 'dead-host:0', NOW() - interval '1 minute')`,
                    [ids[status], userId, status, JSON.stringify({ conversation: conv(), completedTurn: 0 })]);
            }
            await new AgentTaskRepository(real).markParked(ids.paused);
            const expired = await new AgentTaskLeaseRepository(real).listExpiredLeaseTasks();
            for (const id of Object.values(ids)) expect(expired.some((t) => t.id === id)).toBe(false);
            await sweepExpiredTaskLeases();
            for (const id of Object.values(ids)) expect(dispatchMock.mock.calls.filter((c) => c[0].taskId === id)).toHaveLength(0);
        });
    });
});
