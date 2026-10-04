/**
 * spawn_agents 결과 형식 계약 — 태스크별 JSON 스키마(선택)로 결과를 결정적으로 검증하고 실패 시 1회만 교정을 요청한다.
 */
jest.mock('../task-sandbox/approval-gate', () => ({
    ...jest.requireActual('../task-sandbox/approval-gate'),
    getApprovalRegistry: () => ({ isAutoApprove: () => false }),
}));
const runSubagentMock = jest.fn();
jest.mock('../agent-task/subagent', () => ({ runSubagent: (p: unknown) => runSubagentMock(p) }));
jest.mock('../../llm', () => ({ createClient: jest.fn(() => ({})) }));

import { compileOutputContract, extractJson } from './output-schema';
import { runSpawnAgents, buildSpawnParametersSchema } from './spawn-agents';
import { AGENT_DELEGATION } from '../../config/agent-task-delegation';

const SCHEMA = { type: 'object', properties: { city: { type: 'string' }, mm: { type: 'number' } }, required: ['city', 'mm'] };
const base = {
    client: {} as never, tools: [], userCtx: { userId: 'u1', role: 'user' } as never, taskId: '__chat__',
    sandboxCfg: { approvalPolicy: 'none' as const, approvalTimeoutMs: 0 },
};
const PROMPT = '서울의 2026년 9월 강수량을 조사해 보고';
const flags = AGENT_DELEGATION as { OUTPUT_SCHEMA_ENABLED: boolean };

beforeEach(() => { jest.clearAllMocks(); });

describe('extractJson', () => {
    it('본문 전체, 코드 울타리 안, 글 사이의 JSON 을 꺼낸다', () => {
        expect(extractJson('{"a":1}')).toEqual({ a: 1 });
        expect(extractJson('결과입니다.\n```json\n{"a":1}\n```\n이상입니다.')).toEqual({ a: 1 });
        expect(extractJson('조사 결과: [1, 2] 입니다')).toEqual([1, 2]);
    });
    it('JSON 이 없으면 undefined', () => {
        expect(extractJson('강수량은 169mm 입니다')).toBeUndefined();
    });
});

describe('compileOutputContract', () => {
    it('스키마에 맞으면 null, 어긋나면 어디가 틀렸는지 알린다', () => {
        const c = compileOutputContract(SCHEMA);
        if ('error' in c) throw new Error(c.error);
        expect(c.check('{"city":"서울","mm":169.2}')).toBeNull();
        expect(c.check('{"city":"서울","mm":"많음"}')).toMatch(/mm/);
        expect(c.check('강수량은 169mm 입니다')).toMatch(/JSON/);
    });
    it('스키마 자체가 잘못됐거나 너무 크면 오류를 돌려준다', () => {
        expect(compileOutputContract({ type: 'nope' })).toHaveProperty('error');
        expect(compileOutputContract({ type: 'string', description: 'x'.repeat(AGENT_DELEGATION.OUTPUT_SCHEMA_MAX_CHARS) })).toHaveProperty('error');
    });
});

describe('runSpawnAgents — 결과 형식 계약', () => {
    afterEach(() => { flags.OUTPUT_SCHEMA_ENABLED = true; });

    it('기본은 켜짐 — 인자를 주지 않은 태스크는 현행과 같다(지시문 그대로, 최종 답 검사 없음)', async () => {
        expect(AGENT_DELEGATION.OUTPUT_SCHEMA_ENABLED).toBe(true);
        expect(JSON.stringify(buildSpawnParametersSchema())).toContain('outputSchema');
        runSubagentMock.mockResolvedValue('자유 형식 결과');
        const out = await runSpawnAgents({ ...base, args: { tasks: [{ prompt: PROMPT }] } });
        const p = runSubagentMock.mock.calls[0][0];
        expect(p.subgoal).toBe(PROMPT);
        expect(p.finalCheck).toBeUndefined();
        expect(out).not.toContain('형식 검증');
    });

    it('끄면 — outputSchema 를 줘도 무시하고, 도구 스키마에도 드러나지 않는다', async () => {
        flags.OUTPUT_SCHEMA_ENABLED = false;
        runSubagentMock.mockResolvedValue('자유 형식 결과');
        await runSpawnAgents({ ...base, args: { tasks: [{ prompt: PROMPT, outputSchema: SCHEMA }] } });
        const p = runSubagentMock.mock.calls[0][0];
        expect(p.subgoal).toBe(PROMPT);
        expect(p.finalCheck).toBeUndefined();
        expect(JSON.stringify(buildSpawnParametersSchema())).not.toContain('outputSchema');
    });

    it('켜면 스키마를 지시문에 싣고, 어긋난 답에는 교정 요청문을 돌려주며, 최종 판정을 상태 줄에 싣는다', async () => {
        flags.OUTPUT_SCHEMA_ENABLED = true;
        expect(JSON.stringify(buildSpawnParametersSchema())).toContain('outputSchema');
        runSubagentMock.mockImplementation(async (p: { onExit: (r: string) => void }) => { p.onExit('completed'); return '{"city":"서울","mm":169.2}'; });
        const out = await runSpawnAgents({ ...base, args: { tasks: [{ prompt: PROMPT, outputSchema: SCHEMA }] } });
        const p = runSubagentMock.mock.calls[0][0];
        expect(p.subgoal).toContain(PROMPT);
        expect(p.subgoal).toContain('"required":["city","mm"]');
        expect(p.finalCheck('{"city":"서울","mm":169.2}')).toBeNull();
        expect(p.finalCheck('강수량은 169mm')).toMatch(/JSON/);
        expect(out).toContain('[종료 사유: 정상 완료 · 형식 검증 통과]');
    });

    it('교정 뒤에도 어긋나면 결과를 버리지 않고 실패 판정과 함께 돌려준다', async () => {
        flags.OUTPUT_SCHEMA_ENABLED = true;
        runSubagentMock.mockImplementation(async (p: { onExit: (r: string) => void }) => { p.onExit('completed'); return '강수량은 169mm 입니다'; });
        const out = await runSpawnAgents({ ...base, args: { tasks: [{ prompt: PROMPT, outputSchema: SCHEMA }] } });
        expect(out).toMatch(/\[종료 사유: 정상 완료 · 형식 검증 실패/);
        expect(out).toContain('강수량은 169mm 입니다');
    });

    it('스키마가 잘못된 태스크가 있으면 돌리지 않고 이유를 돌려준다', async () => {
        flags.OUTPUT_SCHEMA_ENABLED = true;
        const out = await runSpawnAgents({ ...base, args: { tasks: [{ prompt: PROMPT, outputSchema: { type: 'nope' } }] } });
        expect(out).toMatch(/^Error:[\s\S]*태스크 1: [\s\S]*outputSchema/);
        expect(runSubagentMock).not.toHaveBeenCalled();
    });
});
