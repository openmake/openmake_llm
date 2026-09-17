import { computeSloEvaluations, runSloTick, resetSloRunnerState, sloWindows } from '../slo-runner';
import { SLO_BURN_RULES } from '../../config/slo';

type Handler = (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number };

function poolWith(handler: Handler) {
    const calls: string[] = [];
    return {
        calls,
        pool: { query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push(sql); return handler(sql, params); }) } as never,
    };
}

/** 창 목록 → 모든 창에 같은 total/bad 를 돌려주는 unnest 집계 응답 */
function windowRows(params: unknown[], total: number, bad: number) {
    return (params[0] as string[]).map((w) => ({ w: Number(w), total: String(total), bad: String(bad) }));
}

describe('slo-runner', () => {
    beforeEach(() => resetSloRunnerState());

    it('sloWindows — 전체 창 + fast/slow 긴·짧은 창', () => {
        expect(sloWindows(720)).toEqual([720, SLO_BURN_RULES.fast.longHours, SLO_BURN_RULES.fast.shortHours, SLO_BURN_RULES.slow.longHours, SLO_BURN_RULES.slow.shortHours]);
    });

    it('소스 하나가 실패해도 나머지는 계산하고, 실패 SLO 는 insufficient(source_unavailable)', async () => {
        const { pool } = poolWith((sql, params) => {
            if (sql.includes('agent_tasks')) throw new Error('relation does not exist');
            if (sql.includes('percentile_cont')) return { rows: [{ p95: 8123.4 }] };
            if (sql.includes('to_regclass')) return { rows: [{ ok: false }] };
            if (sql.includes('ttft_ms >')) return { rows: windowRows(params, 100, 1) };
            return { rows: windowRows(params, 1000, 1) };
        });
        const evals = await computeSloEvaluations(pool);
        const by = Object.fromEntries(evals.map((e) => [e.sloId, e]));
        expect(by.chat_availability.state).toBe('ok');
        expect(by.chat_ttft_p95).toMatchObject({ state: 'ok', detail: { thresholdMs: 15000, p95Ms: 8123 } });
        expect(by.agent_task_success).toMatchObject({ state: 'insufficient', reason: 'source_unavailable' });
        expect(by.eval_pass).toMatchObject({ state: 'insufficient' });
    });

    it('tick — fast burn 이면 critical 알림 1회, 다음 tick(같은 상태)은 알림 없음, 스냅샷은 매번 적재', async () => {
        const { pool, calls } = poolWith((sql, params) => {
            if (sql.startsWith('INSERT INTO slo_snapshots')) return { rows: [], rowCount: 1 };
            if (sql.includes('percentile_cont')) return { rows: [{ p95: null }] };
            if (sql.includes('to_regclass')) return { rows: [{ ok: false }] };
            if (sql.includes('chat_requests') && sql.includes("status = 'error'")) return { rows: windowRows(params, 1000, 200) };
            return { rows: windowRows(params, 1000, 0) };
        });
        const sendAlert = jest.fn(async () => undefined);
        await runSloTick(pool, sendAlert, 0);
        expect(sendAlert).toHaveBeenCalledTimes(1);
        expect(sendAlert.mock.calls[0]).toEqual(expect.arrayContaining(['slo_burn_rate', 'critical', 'SLO critical: chat_availability']));
        await runSloTick(pool, sendAlert, 5 * 60_000);
        expect(sendAlert).toHaveBeenCalledTimes(1);
        expect(calls.filter((s) => s.startsWith('INSERT INTO slo_snapshots'))).toHaveLength(8);
    });

    it('같은 tick 의 여러 SLO 는 심각도별 1건으로 묶는다(쿨다운 키 type:severity 에 삼켜지지 않게)', async () => {
        const { pool } = poolWith((sql, params) => {
            if (sql.startsWith('INSERT INTO slo_snapshots')) return { rows: [], rowCount: 1 };
            if (sql.includes('percentile_cont')) return { rows: [{ p95: 20000 }] };
            if (sql.includes('to_regclass')) return { rows: [{ ok: false }] };
            if (sql.includes("status = 'error'") || sql.includes('ttft_ms >')) return { rows: windowRows(params, 1000, 800) };
            if (sql.includes('agent_tasks')) return { rows: windowRows(params, 100, 20) };
            return { rows: [] };
        });
        const sendAlert = jest.fn(async () => undefined);
        await runSloTick(pool, sendAlert, 0);
        const severities = sendAlert.mock.calls.map((c) => (c as unknown[])[1]);
        expect(severities).toEqual(['critical', 'warning']);
        expect((sendAlert.mock.calls[0] as unknown[])[2]).toBe('SLO critical: chat_availability, chat_ttft_p95');
    });
});
