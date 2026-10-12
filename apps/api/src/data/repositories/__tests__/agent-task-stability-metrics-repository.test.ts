/**
 * 안정화 신호 집계 — 기간 안에 만들어진 작업의 전이 이벤트(재시작 중단·복구·복구 상한·시작 대기)와
 * 단계 기록(재시도·가드 발동)을 쿼리 2개로 센다. 행을 가져와 세지 않는다.
 */
import { Pool } from 'pg';
import { AgentTaskStabilityMetricsRepository } from '../agent-task-stability-metrics-repository';
import { AGENT_TASK_STABILITY_STEP_SIGNALS } from '../../../config/agent-task-metrics';

jest.mock('../../retry-wrapper', () => ({ withRetry: (fn: () => unknown) => fn() }));

describe('AgentTaskStabilityMetricsRepository.getStability', () => {
    let pool: Pool;
    let repo: AgentTaskStabilityMetricsRepository;
    beforeEach(() => {
        pool = { query: jest.fn() } as unknown as Pool;
        repo = new AgentTaskStabilityMetricsRepository(pool);
    });

    it('이벤트 신호·단계 신호를 고정 순서로 돌려주고 pg 문자열 수치를 숫자로 바꾼다', async () => {
        (pool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [{ restart_interrupt_n: '4', restart_interrupt_t: '3', recovery_n: '5', recovery_t: '3', recovery_limit_n: '1', recovery_limit_t: '1',
                starts: '12', start_wait_p50_ms: '35.4', start_wait_p95_ms: '61000' }] })
            .mockResolvedValueOnce({ rows: [{ llm_retry_n: '7', llm_retry_t: '2', tool_call_timeout_n: '1', tool_call_timeout_t: '1' }] });
        const r = await repo.getStability(7);

        expect(r.signals.map((s) => s.id)).toEqual(['restart_interrupt', 'recovery', 'recovery_limit', 'model_wait', ...AGENT_TASK_STABILITY_STEP_SIGNALS.map((s) => s.id)]);
        expect(r.signals.find((s) => s.id === 'restart_interrupt')).toEqual({ id: 'restart_interrupt', occurrences: 4, tasks: 3 });
        expect(r.signals.find((s) => s.id === 'recovery_limit')).toEqual({ id: 'recovery_limit', occurrences: 1, tasks: 1 });
        expect(r.signals.find((s) => s.id === 'llm_retry')).toEqual({ id: 'llm_retry', occurrences: 7, tasks: 2 });
        expect(r.signals.find((s) => s.id === 'context_trim')).toEqual({ id: 'context_trim', occurrences: 0, tasks: 0 }); // 행에 없으면 0
        expect(r.queueWait).toEqual({ starts: 12, p50Ms: 35, p95Ms: 61000 });
    });

    it('기간을 매개변수로 넘기고, 이벤트는 전이 사유·단계는 종류와 LIKE 문구로 거른다', async () => {
        (pool.query as jest.Mock).mockResolvedValue({ rows: [{}] });
        await repo.getStability(30);
        const [eventSql, eventParams] = (pool.query as jest.Mock).mock.calls[0];
        const [stepSql, stepParams] = (pool.query as jest.Mock).mock.calls[1];
        expect(eventSql).toContain('agent_task_events');
        expect(eventSql).toContain('make_interval(days => $1)');
        expect(eventParams).toEqual([30, 'server restarted', 'boot recovery claim', 'recovery_limit', 'model_wait']);
        expect(stepSql).toContain('agent_task_steps');
        expect(stepSql).toContain('LIKE');
        expect(stepParams[0]).toBe(30);
        expect(stepParams).toEqual(expect.arrayContaining(['retry', 'tool_result', 'context_trim', 'output_repetition']));
        for (const s of AGENT_TASK_STABILITY_STEP_SIGNALS) if (s.like) expect(stepParams).toContain(s.like);
        expect(stepSql).not.toContain('일시적'); // 문구는 매개변수로만 들어간다
    });

    it('대기열을 거친 시작이 없으면 대기 시간은 null', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ starts: '0', start_wait_p50_ms: null, start_wait_p95_ms: null }] }).mockResolvedValueOnce({ rows: [] });
        const r = await repo.getStability(7);
        expect(r.queueWait).toEqual({ starts: 0, p50Ms: null, p95Ms: null });
        expect(r.signals.every((s) => s.occurrences === 0 && s.tasks === 0)).toBe(true);
    });
});
