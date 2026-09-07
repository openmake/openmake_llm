/**
 * ops_metrics 내장 도구 — 역할·인자 가드(순수)와 질의 디스패치(저장소 mock).
 */
const mockQuery = jest.fn();
jest.mock('../../data/models/unified-database', () => ({
    getPool: () => ({ query: mockQuery }),
    getUnifiedDatabase: () => ({ getPool: () => ({ query: mockQuery }) }),
}));
jest.mock('../../data/retry-wrapper', () => ({ withRetry: (fn: () => unknown) => fn() }));

import { opsMetricsTool, OPS_METRICS_QUERIES } from '../ops-metrics-tool';
import { isToolRestrictedForRole } from '../tool-role-gate';
import { filterRestrictedTools } from '../../services/chat-service/tool-restrictions';

const text = (r: { content: Array<{ text?: string }> }) => r.content[0]?.text ?? '';
const admin = { userId: '3', role: 'admin' as const };

beforeEach(() => { mockQuery.mockReset(); mockQuery.mockResolvedValue({ rows: [] }); });

describe('ops_metrics 가드', () => {
    it('도구 메타 — 이름·필수 인자·query enum', () => {
        expect(opsMetricsTool.tool.name).toBe('ops_metrics');
        expect(opsMetricsTool.tool.inputSchema.required).toEqual(['query']);
        const q = opsMetricsTool.tool.inputSchema.properties.query as { enum: string[] };
        expect(q.enum).toEqual([...OPS_METRICS_QUERIES]);
    });

    it('비관리자·컨텍스트 없음은 거절(DB 접근 없음)', async () => {
        for (const ctx of [undefined, { userId: 'u', role: 'user' as const }, { userId: 'g', role: 'guest' as const }]) {
            const r = await opsMetricsTool.handler({ query: 'summary' }, ctx);
            expect(r.isError).toBe(true);
            expect(text(r)).toContain('관리자 전용');
        }
        expect(mockQuery).not.toHaveBeenCalled();
    });

    it('알 수 없는 query / window 는 거절', async () => {
        const r1 = await opsMetricsTool.handler({ query: 'drop_table' }, admin);
        expect(r1.isError).toBe(true);
        expect(text(r1)).toContain('알 수 없는 query');
        const r2 = await opsMetricsTool.handler({ query: 'summary', window: '99y' }, admin);
        expect(r2.isError).toBe(true);
        expect(text(r2)).toContain('알 수 없는 window');
        expect(mockQuery).not.toHaveBeenCalled();
    });
});

describe('ops_metrics 질의 디스패치', () => {
    it('summary — 기본 창 24h 로 agent_tasks·audit_logs 를 시간 단위 파라미터로 조회', async () => {
        const r = await opsMetricsTool.handler({ query: 'summary' }, admin);
        expect(r.isError).toBe(false);
        const body = JSON.parse(text(r));
        expect(body.window).toBe('24h');
        expect(body.data).toEqual({ runs: [], tool_calls_by_server: [] });
        const sqls = mockQuery.mock.calls.map((c) => String(c[0]));
        expect(sqls.some((s) => /FROM agent_tasks/.test(s))).toBe(true);
        expect(sqls.some((s) => /FROM audit_logs/.test(s) && /mcp_tool_call/.test(s))).toBe(true);
        for (const c of mockQuery.mock.calls) expect(c[1][0]).toBe('24');
    });

    it('failed_runs — window 1h·limit 상한(50) 적용, 실패 상태만', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1', status: 'failed', error: 'goal_incomplete' }] });
        const r = await opsMetricsTool.handler({ query: 'failed_runs', window: '1h', limit: 999 }, admin);
        const body = JSON.parse(text(r));
        expect(body.limit).toBe(50);
        expect(body.data.runs[0].id).toBe('t1');
        const [sql, params] = mockQuery.mock.calls[0];
        expect(String(sql)).toMatch(/status = 'failed'/);
        expect(params).toEqual(['1', '50', '100', '160']);
    });

    it('tool_errors / goal_incomplete — 기존 저장소(tool-health·agent-task-metrics)를 일(day) 환산으로 재사용', async () => {
        await opsMetricsTool.handler({ query: 'tool_errors', window: '7d' }, admin);
        const sqls = mockQuery.mock.calls.map((c) => [String(c[0]), c[1]] as const);
        expect(sqls.some(([s, p]) => /resource_id AS tool/.test(s) && p[0] === '7')).toBe(true);
        mockQuery.mockClear();
        await opsMetricsTool.handler({ query: 'goal_incomplete', window: '30d' }, admin);
        const sqls2 = mockQuery.mock.calls.map((c) => String(c[0]));
        expect(sqls2.some((s) => /judge_verdict/.test(s) && /completion_path/.test(s))).toBe(true);
    });

    it('저장소 오류는 isError 결과로 흡수(채팅을 죽이지 않음)', async () => {
        mockQuery.mockRejectedValue(new Error('relation missing'));
        const r = await opsMetricsTool.handler({ query: 'runs_by_model' }, admin);
        expect(r.isError).toBe(true);
        expect(text(r)).toContain('relation missing');
    });
});

describe('내장 도구 역할 게이트 (BUILTIN_TOOL_REQUIRED_ROLE)', () => {
    const def = (name: string) => ({ type: 'function' as const, function: { name, description: '', parameters: { type: 'object' as const, properties: {} } } });

    it('ops_metrics 는 admin 만 통과, 다른 내장 도구는 영향 없음', () => {
        expect(isToolRestrictedForRole('ops_metrics', 'user')).toBe(true);
        expect(isToolRestrictedForRole('ops_metrics', 'guest')).toBe(true);
        expect(isToolRestrictedForRole('ops_metrics', undefined)).toBe(true);
        expect(isToolRestrictedForRole('ops_metrics', 'admin')).toBe(false);
        expect(isToolRestrictedForRole('web_search', 'guest')).toBe(false);
    });

    it('노출 필터가 비관리자에게서 ops_metrics 를 제거한다', () => {
        const tools = [def('web_search'), def('ops_metrics')];
        expect(filterRestrictedTools(tools, 'user').map((t) => t.function.name)).toEqual(['web_search']);
        expect(filterRestrictedTools(tools, 'admin').map((t) => t.function.name)).toEqual(['web_search', 'ops_metrics']);
    });
});
