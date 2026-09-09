/** groupSubagentSteps — 행 → 서브에이전트(trace, sub_index) 단위 묶음과 정렬 계약. */
import { groupSubagentSteps, deriveSubagentStatus } from '../../routes/agent-task-subagent.routes';

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

describe('deriveSubagentStatus', () => {
    test('등록만 된 서브는 대기 중 — 실행 슬롯을 기다리는 동안에도 목록에 보여야 한다', () => {
        expect(deriveSubagentStatus(['queued'])).toBe('queued');
    });

    test('실행 진입/활동이 있으면 running, 마무리가 있으면 그 결과가 이긴다', () => {
        expect(deriveSubagentStatus(['queued', 'started'])).toBe('running');
        expect(deriveSubagentStatus(['queued', 'started', 'tool_call'])).toBe('running');
        expect(deriveSubagentStatus(['queued', 'started', 'final'])).toBe('completed');
        expect(deriveSubagentStatus(['queued', 'started', 'error'])).toBe('failed');
        expect(deriveSubagentStatus(['queued', 'started', 'final', 'error'])).toBe('failed');
    });

    test('queued/started 마킹 이전 기록(tool_call 로 시작)도 대기 중으로 오판하지 않는다', () => {
        expect(deriveSubagentStatus(['tool_call', 'tool_result'])).toBe('running');
        expect(deriveSubagentStatus(['tool_call', 'final'])).toBe('completed');
    });
});

describe('groupSubagentSteps — 상태·종료 시각', () => {
    test('상태와 finishedAt 이 스텝에서 파생된다', () => {
        const g = groupSubagentSteps([
            row('s1', 0, 0, 'queued', '01'), row('s1', 0, 1, 'started', '02'), row('s1', 0, 2, 'final', '09'),
            row('s1', 1, 0, 'queued', '01'),
        ]);
        expect(g[0].status).toBe('completed');
        expect(g[0].finishedAt).toBe(at('09').toISOString());
        expect(g[1].status).toBe('queued');
        expect(g[1].finishedAt).toBeNull();
    });

    test('부모 작업이 끝났는데 마무리 기록이 없으면 중단으로 — 영원한 "실행 중" 차단', () => {
        const rows = [row('s1', 0, 0, 'queued', '01'), row('s1', 0, 1, 'started', '02')];
        expect(groupSubagentSteps(rows, 'running')[0].status).toBe('running');
        expect(groupSubagentSteps(rows, 'cancelled')[0].status).toBe('interrupted');
        expect(groupSubagentSteps(rows, 'failed')[0].status).toBe('interrupted');
    });

    test('부모가 끝나도 이미 마무리된 서브의 상태는 바뀌지 않는다', () => {
        const g = groupSubagentSteps([row('s1', 0, 0, 'final', '05')], 'completed');
        expect(g[0].status).toBe('completed');
    });
});
