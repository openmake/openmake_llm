/**
 * 큰 도구 결과 보관의 연결 — task 도구(TaskRuntime.executeTaskTool)와 외부 도구(runTool) 양쪽.
 */
jest.mock('../../../config/agent-task-context', () => {
    const actual = jest.requireActual('../../../config/agent-task-context');
    return { ...actual, TOOL_RESULT_SPILL: { ...actual.TOOL_RESULT_SPILL, ENABLED: true } };
});
jest.mock('../../tool-result-truncation-recorder', () => ({ recordToolResultTruncation: jest.fn() }));

import { __setChatTurnIntegrationsForTest } from '../../chat-service/turn-integrations';
import { TaskRuntime } from '../../task-sandbox/runtime';
import { runTool } from '../task-steps';
import { getTaskSandboxConfig } from '../../../config/task-sandbox';
import { MAX_TOOL_RESULT_CHARS } from '../../../config/runtime-limits';
import { TOOL_RESULT_SPILL } from '../../../config/agent-task-context';
import type { ToolRuntime } from '../../../runtime-ports/tool-runtime';

beforeAll(() => __setChatTurnIntegrationsForTest([]));
afterAll(() => __setChatTurnIntegrationsForTest(null));

const cfg = { ...getTaskSandboxConfig(), approvalPolicy: 'none' as const };
const big = Array.from({ length: 2000 }, (_, i) => `row ${i + 1}`).join('\n'); // 상한(8000자)보다 크다

function executor(localWorkdir: string | null) {
    const files = new Map<string, string>();
    return {
        files,
        localWorkdir,
        isBrowserEnabled: false,
        exec: async () => ({ stdout: big, stderr: '', exitCode: 0, truncated: false, timedOut: false, durationMs: 1 }),
        writeFile: async (p: string, c: string) => { files.set(p, c); },
    };
}

describe('task 도구 결과 보관', () => {
    it('서버 샌드박스 — 상한을 넘는 bash 결과를 파일로 쓰고 경로를 안내한다', async () => {
        expect(big.length).toBeGreaterThan(MAX_TOOL_RESULT_CHARS);
        const ex = executor('/tmp/ws');
        const rt = new TaskRuntime('t-spill', 'u1', cfg, undefined, undefined, ex as never);
        const out = await rt.executeTaskTool('bash', { command: 'cat big.txt' });
        const path = [...ex.files.keys()].find((p) => p.endsWith('.txt'))!;
        expect(path.startsWith(`${TOOL_RESULT_SPILL.DIR}/bash-`)).toBe(true);
        expect(ex.files.get(path)).toContain('row 1000');
        expect(out).toContain(path);
        expect(out).toContain('row 1\n');
        expect(out).toContain('[exit=0');
        expect(out).not.toContain('row 1000\n');
    });

    it('로컬 실행기(호스트 작업 공간 없음) — 파일을 쓰지 않고 종전대로 절단한다', async () => {
        const ex = executor(null);
        const rt = new TaskRuntime('t-nospill', 'u1', cfg, undefined, undefined, ex as never);
        const out = await rt.executeTaskTool('bash', { command: 'cat big.txt' });
        expect(ex.files.size).toBe(0);
        expect(out).toContain('생략');
        expect(out).not.toContain(TOOL_RESULT_SPILL.DIR);
    });

    it('상한 이하 결과는 그대로다', async () => {
        const ex = { ...executor('/tmp/ws'), exec: async () => ({ stdout: 'ok', stderr: '', exitCode: 0, truncated: false, timedOut: false, durationMs: 1 }) };
        const rt = new TaskRuntime('t-small', 'u1', cfg, undefined, undefined, ex as never);
        expect(await rt.executeTaskTool('bash', { command: 'echo ok' })).toBe('[stdout]\nok\n[exit=0 1ms]');
        expect(ex.files.size).toBe(0);
    });
});

describe('외부 도구(runTool) 결과 보관', () => {
    const mcp = { executeTool: async () => ({ content: big, isError: false }) } as unknown as ToolRuntime;
    const ctx = { userId: 'u1', role: 'user' } as never;

    it('보관 함수를 받으면 그 결과를 쓴다', async () => {
        const ex = executor('/tmp/ws');
        const rt = new TaskRuntime('t-ext', 'u1', cfg, undefined, undefined, ex as never);
        const out = await runTool(mcp, 'web_search', {}, ctx, rt.spillLargeResult);
        const path = [...ex.files.keys()].find((p) => p.endsWith('.txt'))!;
        expect(path).toContain('web_search-');
        expect(out).toContain(path);
    });

    it('보관 함수가 없으면 종전대로 절단한다', async () => {
        const out = await runTool(mcp, 'web_search', {}, ctx);
        expect(out).toContain('생략');
        expect(out).not.toContain(TOOL_RESULT_SPILL.DIR);
    });
});
