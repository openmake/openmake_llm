/**
 * 프롬프트 규칙 제거 실험 CLI — 첫 과제를 만들기 전에 스키마 초기화를 기다리는지.
 * 기다리지 않으면 초기화의 좀비 정리가 방금 running 이 된 첫 과제를 failed 로 바꾼다.
 */
const order: string[] = [];
const db = {
    ensureReady: jest.fn(async () => {
        await new Promise((resolve) => setImmediate(resolve));
        order.push('ready');
    }),
    createAgentTask: jest.fn(async () => { order.push('create'); }),
    getAgentTask: jest.fn(async (): Promise<Record<string, unknown>> => ({ status: 'completed', current_turn: 1, total_tokens: 1 })),
    getAgentTaskSteps: jest.fn(async (): Promise<unknown[]> => []),
};
const written: string[] = [];

// 결과 파일은 쓰지 않는다(과제 묶음 읽기는 실제 fs 그대로).
jest.mock('fs', () => ({ ...jest.requireActual('fs'), mkdirSync: jest.fn(), writeFileSync: jest.fn((_p: string, body: string) => { written.push(body); }) }));
jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../../prompts/agent-task-prompt', () => ({ getAgentTaskSystemPrompt: () => 'You are an agent.' }));
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: () => db }));
jest.mock('../../services/AgentTaskService', () => ({
    AgentTaskService: class { async execute(): Promise<void> { order.push('execute'); } },
}));

describe('run-prompt-ablation', () => {
    const argv = process.argv;

    afterEach(() => {
        process.argv = argv;
        jest.restoreAllMocks();
    });

    /** 실행기를 새로 불러 끝까지 돌리고 종료 코드를 돌려준다. */
    async function runCli(args: string[]): Promise<number | undefined> {
        process.argv = ['node', 'run-prompt-ablation.ts', ...args];
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const exited = new Promise<number | undefined>((resolve) => {
            jest.spyOn(process, 'exit').mockImplementation(((code?: number) => { resolve(code); }) as never);
        });
        db.createAgentTask.mockClear();
        written.length = 0;
        jest.isolateModules(() => { require('../run-prompt-ablation'); });
        return exited;
    }
    const createdGoals = (): string[] => (db.createAgentTask.mock.calls as unknown as Array<[{ goal: string }]>).map((c) => c[0].goal);
    const dataset = jest.requireActual('../golden-agent-tasks.json') as { cases: Array<{ id: string; goal: string }>; browserCases: Array<{ id: string; goal: string }> };

    it('스키마 초기화가 끝난 뒤에 첫 과제를 만든다', async () => {
        process.argv = ['node', 'run-prompt-ablation.ts', '--variants', 'baseline', '--limit', '1'];
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        const exited = new Promise<number | undefined>((resolve) => {
            jest.spyOn(process, 'exit').mockImplementation(((code?: number) => { resolve(code); }) as never);
        });

        require('../run-prompt-ablation');

        expect(await exited).toBe(0);
        expect(order).toEqual(['ready', 'create', 'execute']);
    });

    it('--only 로 지목한 과제만 돌린다', async () => {
        process.argv = ['node', 'run-prompt-ablation.ts', '--variants', 'baseline', '--only', 'trap-tail-of-large-file,edit-notes'];
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        const exited = new Promise<number | undefined>((resolve) => {
            jest.spyOn(process, 'exit').mockImplementation(((code?: number) => { resolve(code); }) as never);
        });
        db.createAgentTask.mockClear();

        jest.isolateModules(() => { require('../run-prompt-ablation'); });

        expect(await exited).toBe(0);
        const goals = (db.createAgentTask.mock.calls as unknown as Array<[{ goal: string }]>).map((c) => c[0].goal);
        const dataset = jest.requireActual('../golden-agent-tasks.json') as { cases: Array<{ id: string; goal: string }> };
        expect(goals).toEqual(['edit-notes', 'trap-tail-of-large-file'].map((id) => dataset.cases.find((c) => c.id === id)?.goal));
    });

    describe('브라우저 과제(--browser)', () => {
        it('기본 실행은 브라우저 과제를 돌리지 않는다 — 외부 사이트에 의존하지 않는다', async () => {
            expect(await runCli(['--variants', 'baseline'])).toBe(0);
            expect(createdGoals()).toEqual(dataset.cases.map((c) => c.goal));
            expect(await runCli(['--variants', 'baseline', '--only', 'browser-page-heading'])).toBe(1);
        });

        it('--browser 는 브라우저 과제를 묶음 뒤에 더한다', async () => {
            expect(await runCli(['--variants', 'baseline', '--browser'])).toBe(0);
            expect(createdGoals()).toEqual([...dataset.cases, ...dataset.browserCases].map((c) => c.goal));
        });

        it('--browser only 는 브라우저 과제만 돌리고, 최종 답변의 정답 문자열로 완료를 채점한다', async () => {
            db.getAgentTask
                .mockResolvedValueOnce({ status: 'completed', current_turn: 2, total_tokens: 10, result: '제목은 "Example Domains" 입니다.' })
                .mockResolvedValueOnce({ status: 'completed', current_turn: 2, total_tokens: 10, result: 'RFC 2606 만 있습니다.' });
            db.getAgentTaskSteps.mockResolvedValue([{ step_number: 1, step_type: 'tool_result', tool_name: 'browser', tool_args: '{}' }]);

            expect(await runCli(['--variants', 'baseline', '--browser', 'only'])).toBe(0);

            db.getAgentTaskSteps.mockResolvedValue([]);
            expect(createdGoals()).toEqual(dataset.browserCases.map((c) => c.goal));
            const out = JSON.parse(written[0]) as { summary: Array<{ completedRate: number }>; runs: Array<{ caseId: string; status: string; answerPassed?: boolean; browserCalls?: number }> };
            expect(out.runs.map((r) => [r.caseId, r.status, r.answerPassed, r.browserCalls])).toEqual([
                ['browser-page-heading', 'completed', true, 1],
                ['browser-extract-list', 'completed', false, 1],
            ]);
            expect(out.summary[0].completedRate).toBe(0.5);
        });
    });
});
