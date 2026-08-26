/** groupSubagentSteps — 행 → 서브에이전트(trace, sub_index) 단위 묶음과 정렬 계약. */
import { groupSubagentSteps } from '../../routes/agent-task-subagent.routes';

const at = (s: string) => new Date(`2026-08-26T10:00:${s}Z`);
const row = (trace: string, sub: number, seq: number, type: string, sec: string, tool: string | null = null) => ({
    id: `${trace}-${sub}-${seq}`, task_id: 't', trace_id: trace, origin: trace === 'd' ? 'delegate' : 'spawn_agents',
    sub_index: sub, label: null, seq, step_type: type, tool_name: tool, content: `${type}:${seq}`, created_at: at(sec),
});

describe('groupSubagentSteps', () => {
    test('같은 fan-out 의 서브들은 sub_index 로 갈리고, 서브 안은 seq 순서다', () => {
        const rows = [
            row('s1', 1, 1, 'tool_result', '05'), row('s1', 1, 0, 'tool_call', '04', 'web_search'),
            row('s1', 0, 0, 'tool_call', '03', 'web_search'), row('s1', 0, 1, 'final', '06'),
        ];
        const g = groupSubagentSteps(rows);
        expect(g.map((t) => t.subIndex)).toEqual([0, 1]);
        expect(g[1].steps.map((s) => s.seq)).toEqual([1, 0]); // 입력 순서 유지(정렬은 DB 가 한다)
        expect(g[0].startedAt).toBe(at('03').toISOString());
    });

    test('delegate 와 spawn 이 섞여도 시작 시각 오름차순', () => {
        const g = groupSubagentSteps([row('s9', 0, 0, 'final', '30'), row('d', 0, 0, 'final', '10')]);
        expect(g.map((t) => t.origin)).toEqual(['delegate', 'spawn_agents']);
    });

    test('빈 입력은 빈 배열', () => {
        expect(groupSubagentSteps([])).toEqual([]);
    });
});
