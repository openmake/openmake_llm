/**
 * McpCatalogRepository — Phase 5 metrics (getServerInstanceMetrics, getUserInstancesSummary).
 */
import { Pool } from 'pg';
import { McpCatalogRepository } from '../../../data/repositories/mcp-catalog-repository';
import { McpAdminMonitoringRepository } from '../../../data/repositories/mcp-admin-monitoring-repository';

const CONN = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const SUFFIX = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const UID = `test-metrics-${SUFFIX}`;
const SID1 = `mcp-metrics-${SUFFIX}-1`;
const SID2 = `mcp-metrics-${SUFFIX}-2`;

const describeOrSkip = CONN ? describe : describe.skip;

describeOrSkip('McpCatalogRepository.getServerInstanceMetrics', () => {
    let pool: Pool;
    let repo: McpCatalogRepository;

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN });
        repo = new McpCatalogRepository(pool);
        await pool.query(
            `INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, 'h', 'user') ON CONFLICT DO NOTHING`,
            [UID, UID],
        );
        await pool.query(
            `INSERT INTO mcp_servers (id, name, transport_type, command, user_id, visibility, enabled)
             VALUES ($1, $2, 'stdio', '/bin/true', $3, 'user_private', FALSE),
                    ($4, $5, 'stdio', '/bin/true', $3, 'user_private', FALSE)
             ON CONFLICT (id) DO NOTHING`,
            [SID1, `metrics-${SUFFIX}-1`, UID, SID2, `metrics-${SUFFIX}-2`],
        );
    });

    beforeEach(async () => {
        await pool.query(`DELETE FROM mcp_server_instances WHERE user_id=$1`, [UID]);
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM mcp_server_instances WHERE user_id=$1`, [UID]);
        await pool.query(`DELETE FROM mcp_servers WHERE user_id=$1`, [UID]);
        await pool.query(`DELETE FROM users WHERE id=$1`, [UID]);
        await pool.end();
    });

    test('빈 상태 — 모든 카운트 0, avgUptime null', async () => {
        const m = await repo.getServerInstanceMetrics(SID1, UID);
        expect(m.currentRunning).toBe(0);
        expect(m.totalSpawned).toBe(0);
        expect(m.crashed24h).toBe(0);
        expect(m.avgUptimeSec).toBeNull();
        expect(m.lastErrorAt).toBeNull();
        expect(m.lastErrorMessage).toBeNull();
    });

    test('currentRunning — 최신 transition 기준 (이력 누적 카운트 회귀 방지)', async () => {
        // append-only 이력에 같은 (server,user) 의 전이 3회를 기록해도
        // 현재 running 인스턴스는 1 (최신 transition = running). totalSpawned 만 누적된다.
        // 구버그: COUNT(*) FILTER (status IN starting,running) 가 전이 3개를 모두 세 3 반환.
        await repo.recordInstanceTransition(SID1, UID, 'running', 1001);
        await repo.recordInstanceTransition(SID1, UID, 'starting');
        await repo.recordInstanceTransition(SID1, UID, 'running', 1002);
        const m = await repo.getServerInstanceMetrics(SID1, UID);
        expect(m.currentRunning).toBe(1);
        expect(m.totalSpawned).toBe(3);
    });

    test('crashed24h + lastError 채워짐', async () => {
        await repo.recordInstanceTransition(SID1, UID, 'crashed', undefined, 'boom');
        const m = await repo.getServerInstanceMetrics(SID1, UID);
        expect(m.crashed24h).toBe(1);
        expect(m.totalSpawned).toBe(1);
        expect(m.lastErrorMessage).toBe('boom');
        expect(m.lastErrorAt).toBeTruthy();
    });

    test('avgUptimeSec — stopped 완료 row 들의 평균', async () => {
        // started_at 은 NOW() 라 uptime 이 0 근처 (record 호출 시 같은 시점)
        // - stopped/crashed 의 started_at 과 stopped_at 이 같은 record 안에서 NOW() 두 번 호출
        // - 평균이 양수 (보통 0-1ms) 이거나 null 아닌 numeric
        await repo.recordInstanceTransition(SID1, UID, 'stopped', 2001);
        await repo.recordInstanceTransition(SID1, UID, 'stopped', 2002);
        const m = await repo.getServerInstanceMetrics(SID1, UID);
        expect(m.avgUptimeSec).not.toBeNull();
        // started_at = NOW() (PG), stopped_at = new Date().toISOString() (JS) — clock skew 로 ±1초 가능.
        // 핵심: numeric, finite, |X| <= 5 (정상 동작 의 indicator)
        expect(Math.abs(m.avgUptimeSec as number)).toBeLessThanOrEqual(5);
    });

    test('다른 server 의 instance 는 격리', async () => {
        await repo.recordInstanceTransition(SID2, UID, 'running', 3001);
        const m1 = await repo.getServerInstanceMetrics(SID1, UID);
        expect(m1.totalSpawned).toBe(0);
        const m2 = await repo.getServerInstanceMetrics(SID2, UID);
        expect(m2.currentRunning).toBe(1);
    });
});

describeOrSkip('McpAdminMonitoringRepository — getGlobalInstanceSummary / getTopCrashedServers / getCrashTrendByHour', () => {
    let pool: Pool;
    let catalogRepo: McpCatalogRepository;
    let adminRepo: McpAdminMonitoringRepository;
    const UID4 = `test-global-${SUFFIX}`;
    const SID6 = `mcp-global-${SUFFIX}`;

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN });
        catalogRepo = new McpCatalogRepository(pool);
        adminRepo = new McpAdminMonitoringRepository(pool);
        await pool.query(
            `INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, 'h', 'user') ON CONFLICT DO NOTHING`,
            [UID4, UID4],
        );
        await pool.query(
            `INSERT INTO mcp_servers (id, name, transport_type, command, user_id, visibility, enabled)
             VALUES ($1, $2, 'stdio', '/bin/true', $3, 'user_private', FALSE)
             ON CONFLICT (id) DO NOTHING`,
            [SID6, `global-${SUFFIX}`, UID4],
        );
        await pool.query(`DELETE FROM mcp_server_instances WHERE user_id=$1`, [UID4]);
        await catalogRepo.recordInstanceTransition(SID6, UID4, 'running', 5001);
        await catalogRepo.recordInstanceTransition(SID6, UID4, 'crashed', undefined, 'e1');
        await catalogRepo.recordInstanceTransition(SID6, UID4, 'crashed', undefined, 'e2');
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM mcp_server_instances WHERE user_id=$1`, [UID4]);
        await pool.query(`DELETE FROM mcp_servers WHERE user_id=$1`, [UID4]);
        await pool.query(`DELETE FROM users WHERE id=$1`, [UID4]);
        await pool.end();
    });

    test('getGlobalInstanceSummary — 본 test 의 카운트는 포함되어야 함', async () => {
        const s = await adminRepo.getGlobalInstanceSummary();
        expect(s.totalServers).toBeGreaterThanOrEqual(1);
        expect(s.currentRunning).toBeGreaterThanOrEqual(1);
        expect(s.totalSpawned).toBeGreaterThanOrEqual(3);
        expect(s.crashed24h).toBeGreaterThanOrEqual(2);
        // crashRate24hPct: 본 test 가 spawn 3 / crashed 2 추가, 다른 row 도 있을 수 있음
        if (s.crashRate24hPct != null) {
            expect(s.crashRate24hPct).toBeGreaterThanOrEqual(0);
            expect(s.crashRate24hPct).toBeLessThanOrEqual(100);
        }
    });

    test('getTopCrashedServers — 본 server 가 결과에 포함', async () => {
        const items = await adminRepo.getTopCrashedServers(50);
        const found = items.find(x => x.mcp_server_id === SID6);
        expect(found).toBeDefined();
        expect(found?.crash_count).toBeGreaterThanOrEqual(2);
        expect(found?.user_id).toBe(UID4);
    });

    test('getCrashTrendByHour — 24개 시간 슬롯 반환', async () => {
        const timeline = await adminRepo.getCrashTrendByHour();
        expect(timeline.length).toBe(24);
        for (const row of timeline) {
            expect(typeof row.hour).toBe('string');
            expect(typeof row.spawned).toBe('number');
            expect(typeof row.crashed).toBe('number');
            expect(row.spawned).toBeGreaterThanOrEqual(0);
            expect(row.crashed).toBeGreaterThanOrEqual(0);
        }
        // 본 test row 들이 현재 시간대에 포함됨
        const totalSpawned = timeline.reduce((a: number, t: { spawned: number }) => a + t.spawned, 0);
        const totalCrashed = timeline.reduce((a: number, t: { crashed: number }) => a + t.crashed, 0);
        expect(totalSpawned).toBeGreaterThanOrEqual(3);
        expect(totalCrashed).toBeGreaterThanOrEqual(2);
    });
});

describeOrSkip('McpCatalogRepository.verifyRunningInstancesByPid', () => {
    let pool: Pool;
    let repo: McpCatalogRepository;
    const UID3 = `test-health-${SUFFIX}`;
    const SID5 = `mcp-health-${SUFFIX}`;

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN });
        repo = new McpCatalogRepository(pool);
        await pool.query(
            `INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, 'h', 'user') ON CONFLICT DO NOTHING`,
            [UID3, UID3],
        );
        await pool.query(
            `INSERT INTO mcp_servers (id, name, transport_type, command, user_id, visibility, enabled)
             VALUES ($1, $2, 'stdio', '/bin/true', $3, 'user_private', FALSE)
             ON CONFLICT (id) DO NOTHING`,
            [SID5, `health-${SUFFIX}`, UID3],
        );
    });

    beforeEach(async () => {
        await pool.query(`DELETE FROM mcp_server_instances WHERE user_id=$1`, [UID3]);
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM mcp_server_instances WHERE user_id=$1`, [UID3]);
        await pool.query(`DELETE FROM mcp_servers WHERE user_id=$1`, [UID3]);
        await pool.query(`DELETE FROM users WHERE id=$1`, [UID3]);
        await pool.end();
    });

    test('현재 process(pid=process.pid) → alive 로 verified', async () => {
        await repo.recordInstanceTransition(SID5, UID3, 'running', process.pid);
        const r = await repo.verifyRunningInstancesByPid(SID5, UID3);
        expect(r.verified).toBe(1);
        expect(r.declaredDead).toBe(0);
        expect(r.missingPid).toBe(0);
    });

    test('존재하지 않는 pid (99999999) → declaredDead + status crashed UPDATE', async () => {
        await repo.recordInstanceTransition(SID5, UID3, 'running', 99999999);
        const r = await repo.verifyRunningInstancesByPid(SID5, UID3);
        expect(r.declaredDead).toBe(1);
        expect(r.verified).toBe(0);
        const after = await pool.query<{ status: string; last_error: string | null }>(
            `SELECT status, last_error FROM mcp_server_instances WHERE user_id=$1 AND mcp_server_id=$2`,
            [UID3, SID5],
        );
        expect(after.rows[0].status).toBe('crashed');
        expect(after.rows[0].last_error).toMatch(/health check|not alive/);
    });

    test('pid 가 null 인 row → missingPid 카운트 + status 변경 없음', async () => {
        await repo.recordInstanceTransition(SID5, UID3, 'running');
        const r = await repo.verifyRunningInstancesByPid(SID5, UID3);
        expect(r.missingPid).toBe(1);
        expect(r.declaredDead).toBe(0);
        const after = await pool.query<{ status: string }>(
            `SELECT status FROM mcp_server_instances WHERE user_id=$1 AND mcp_server_id=$2`,
            [UID3, SID5],
        );
        expect(after.rows[0].status).toBe('running');
    });

    test('stopped/crashed row 는 검증 대상 아님', async () => {
        await repo.recordInstanceTransition(SID5, UID3, 'stopped', process.pid);
        await repo.recordInstanceTransition(SID5, UID3, 'crashed', undefined, 'err');
        const r = await repo.verifyRunningInstancesByPid(SID5, UID3);
        expect(r.verified).toBe(0);
        expect(r.declaredDead).toBe(0);
        expect(r.missingPid).toBe(0);
    });
});

describeOrSkip('McpCatalogRepository.getUserInstancesSummary', () => {
    let pool: Pool;
    let repo: McpCatalogRepository;
    const UID2 = `test-summary-${SUFFIX}`;
    const SID3 = `mcp-summary-${SUFFIX}-1`;
    const SID4 = `mcp-summary-${SUFFIX}-2`;

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN });
        repo = new McpCatalogRepository(pool);
        await pool.query(
            `INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, 'h', 'user') ON CONFLICT DO NOTHING`,
            [UID2, UID2],
        );
        await pool.query(
            `INSERT INTO mcp_servers (id, name, transport_type, command, user_id, visibility, enabled)
             VALUES ($1, $2, 'stdio', '/bin/true', $3, 'user_private', FALSE),
                    ($4, $5, 'stdio', '/bin/true', $3, 'user_private', FALSE)
             ON CONFLICT (id) DO NOTHING`,
            [SID3, `summary-${SUFFIX}-1`, UID2, SID4, `summary-${SUFFIX}-2`],
        );
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM mcp_server_instances WHERE user_id=$1`, [UID2]);
        await pool.query(`DELETE FROM mcp_servers WHERE user_id=$1`, [UID2]);
        await pool.query(`DELETE FROM users WHERE id=$1`, [UID2]);
        await pool.end();
    });

    test('summary — totalServers / running / spawned / crashed24h', async () => {
        await repo.recordInstanceTransition(SID3, UID2, 'running', 4001);
        await repo.recordInstanceTransition(SID4, UID2, 'crashed', undefined, 'err');
        const s = await repo.getUserInstancesSummary(UID2);
        expect(s.totalServers).toBe(2);
        expect(s.currentRunning).toBe(1);
        expect(s.totalSpawned).toBe(2);
        expect(s.crashed24h).toBe(1);
    });
});
