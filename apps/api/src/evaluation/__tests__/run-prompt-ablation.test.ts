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
    getAgentTask: jest.fn(async () => ({ status: 'completed', current_turn: 1, total_tokens: 1 })),
    getAgentTaskSteps: jest.fn(async () => []),
};

// 결과 파일은 쓰지 않는다(과제 묶음 읽기는 실제 fs 그대로).
jest.mock('fs', () => ({ ...jest.requireActual('fs'), mkdirSync: jest.fn(), writeFileSync: jest.fn() }));
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
});
