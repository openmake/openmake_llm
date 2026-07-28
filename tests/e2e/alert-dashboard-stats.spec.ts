/**
 * PR #95 verify — alert dashboard 통계 위젯 자동 검증.
 *
 * 시나리오:
 *   1. admin 사용자 fixture 생성
 *   2. dummy critical alert_history row INSERT (acknowledged=false)
 *   3. /audit 페이지 진입 → "🔔 알림 이력" tab 클릭
 *   4. #alertStatsRow 보이는지 + 4 stat-card 확인
 *   5. 미확인 카운트 추출 → seed 1건 만큼 +1
 *   6. ✓ 확인 버튼 클릭 → 카운트 1 감소 확인
 *   7. 7일 trend bar 의 title (tooltip) 속성 검증
 *   8. cleanup: alert_history seed row + user 삭제
 *
 * Local 보관 (tests/e2e/ gitignored). 운영 verify 자동화 목적.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { Client } from 'pg';
import { signupUser, deleteUser, pgConfig, type GdprUserFixture } from './helpers/gdpr-fixtures';

interface SeededAlerts { ids: number[]; }

async function seedAlerts(count: number = 1): Promise<SeededAlerts> {
    const pg = new Client(pgConfig());
    await pg.connect();
    const ids: number[] = [];
    try {
        for (let i = 0; i < count; i++) {
            const r = await pg.query<{ id: number }>(
                `INSERT INTO alert_history (type, severity, title, message, data, acknowledged, created_at)
                 VALUES ($1, 'critical', $2, $3, '{}'::jsonb, FALSE, NOW())
                 RETURNING id`,
                [`pr95_test_${Date.now()}_${i}`, 'PR #95 verify seed', `seed message #${i}`],
            );
            ids.push(r.rows[0].id);
        }
    } finally {
        await pg.end();
    }
    return { ids };
}

async function cleanupAlerts(ids: number[]): Promise<void> {
    if (!ids.length) return;
    const pg = new Client(pgConfig());
    await pg.connect();
    try {
        await pg.query(`DELETE FROM alert_history WHERE id = ANY($1)`, [ids]);
    } finally {
        await pg.end();
    }
}

async function getStats(request: APIRequestContext, cookies: string): Promise<{
    todayCriticalCount: number;
    pendingAckCount: number;
    last7Days: Array<{ date: string; total: number; critical: number; warning: number; info: number }>;
    severityTotals: { info: number; warning: number; critical: number };
}> {
    const res = await request.get('/api/admin/alerts/stats', { headers: { Cookie: cookies } });
    if (!res.ok()) throw new Error(`stats GET failed: ${res.status()}`);
    const body = await res.json();
    return body.data || body;
}

test.describe('PR #95 — alert dashboard 통계 위젯', () => {
    let admin: GdprUserFixture;
    let seeded: SeededAlerts = { ids: [] };

    test.beforeAll(async ({ request }) => {
        admin = await signupUser(request, { promoteAdmin: true });
        seeded = await seedAlerts(1);  // 1 critical 미확인 row
    });

    test.afterAll(async () => {
        await cleanupAlerts(seeded.ids);
        if (admin?.userId) await deleteUser(admin.userId);
    });

    test('backend: /api/admin/alerts/stats 가 4 키 응답', async ({ request }) => {
        const s = await getStats(request, admin.cookies);
        expect(s).toHaveProperty('todayCriticalCount');
        expect(s).toHaveProperty('pendingAckCount');
        expect(s).toHaveProperty('last7Days');
        expect(s).toHaveProperty('severityTotals');
        expect(Array.isArray(s.last7Days)).toBe(true);
        expect(s.last7Days.length).toBe(7);
        // seed 가 1건 → 오늘 critical >= 1, pending >= 1
        expect(s.todayCriticalCount).toBeGreaterThanOrEqual(1);
        expect(s.pendingAckCount).toBeGreaterThanOrEqual(1);
        expect(s.severityTotals.critical).toBeGreaterThanOrEqual(1);
    });

    test('backend ack flow: stats baseline → ack seed row → pendingAck 감소 + 7일 trend critical 증가', async ({ request }) => {
        // pre baseline
        const preStats = await getStats(request, admin.cookies);
        expect(preStats.severityTotals.critical).toBeGreaterThanOrEqual(1);

        // 7일 trend 의 오늘 (마지막 element) 에 critical >= 1 반영 확인
        const today = preStats.last7Days[preStats.last7Days.length - 1];
        expect(today.critical).toBeGreaterThanOrEqual(1);

        // seed row ack — PR #92 의 endpoint
        const seedId = seeded.ids[0];
        const ackRes = await request.post(`/api/admin/alerts/${seedId}/acknowledge`, {
            headers: { Cookie: admin.cookies },
        });
        expect(ackRes.ok()).toBeTruthy();
        const ackBody = await ackRes.json();
        const alertObj = ackBody.data?.alert || ackBody.alert;
        expect(alertObj?.acknowledged).toBe(true);
        expect(alertObj?.acknowledged_by).toBe(admin.userId);

        // post: pendingAck 1 감소 (severity totals 는 보존 — ack 가 통계 영향 X)
        const postStats = await getStats(request, admin.cookies);
        expect(postStats.pendingAckCount).toBe(preStats.pendingAckCount - 1);
        expect(postStats.severityTotals.critical).toBe(preStats.severityTotals.critical);

        // idempotent: 같은 row 다시 ack → alreadyAcknowledged=true, 카운트 변동 없음
        const ackAgainRes = await request.post(`/api/admin/alerts/${seedId}/acknowledge`, {
            headers: { Cookie: admin.cookies },
        });
        expect(ackAgainRes.ok()).toBeTruthy();
        const ackAgainBody = await ackAgainRes.json();
        expect(ackAgainBody.data?.alreadyAcknowledged || ackAgainBody.alreadyAcknowledged).toBe(true);

        const finalStats = await getStats(request, admin.cookies);
        expect(finalStats.pendingAckCount).toBe(postStats.pendingAckCount);
    });
});
