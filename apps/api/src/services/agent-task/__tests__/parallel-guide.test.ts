/**
 * 병렬 분담 안내 — 도구가 실릴 때만 시스템 프롬프트에 붙는지.
 *
 * `AGENT_SPAWN.ENABLED` 는 env 파생이라 모듈을 격리 로드한다(운영 .env 가 섞이지 않게).
 */
export {};

const ENV_KEY = 'AGENT_SPAWN_ENABLED';
let saved: string | undefined;

beforeAll(() => { saved = process.env[ENV_KEY]; });
afterAll(() => {
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
    jest.resetModules();
});

function loadPrompt() {
    jest.resetModules();
    return require('../../../prompts/agent-task-prompt') as typeof import('../../../prompts/agent-task-prompt');
}

describe('getAgentTaskParallelGuide', () => {
    it('더 싼 병렬 수단(한 턴 다중 도구 호출)을 먼저 권한다', () => {
        const g = loadPrompt().getAgentTaskParallelGuide();
        // 실측: 독립 단발 조회 3건에서 모델은 spawn 대신 web_search 3개를 한 턴에 냈고 그쪽이 싸다.
        const cheap = g.indexOf('ONE turn');
        const spawn = g.indexOf('spawn_agents');
        expect(cheap).toBeGreaterThanOrEqual(0);
        expect(spawn).toBeGreaterThan(cheap);
    });

    it('spawn 의 이득 경계(갈래마다 여러 턴)를 명시한다', () => {
        const g = loadPrompt().getAgentTaskParallelGuide();
        expect(g).toContain('spawn_agents');
        expect(g).toMatch(/MULTIPLE steps/);
        // 남용 경계가 빠지면 순차 작업까지 병렬로 쪼개려 든다.
        expect(g).toMatch(/depend on each other in sequence/);
        // 서브는 부모 컨텍스트를 못 보므로 자기완결 지시가 필수라는 사실.
        expect(g).toMatch(/self-contained/);
    });
});

describe('작업 시스템 프롬프트 조립 — 게이트 연동', () => {
    /** skill-block 은 DB 의존 블록을 포함하므로, 게이트 분기만 좁게 확인한다. */
    function assembled(enabled: boolean): string {
        if (enabled) process.env[ENV_KEY] = 'true';
        else delete process.env[ENV_KEY];
        jest.resetModules();
        const { AGENT_SPAWN } = require('../../../config/runtime-limits') as typeof import('../../../config/runtime-limits');
        const prompt = require('../../../prompts/agent-task-prompt') as typeof import('../../../prompts/agent-task-prompt');
        return prompt.getAgentTaskSystemPrompt() + (AGENT_SPAWN.ENABLED ? prompt.getAgentTaskParallelGuide() : '');
    }

    it('게이트 ON 이면 안내가 붙는다', () => {
        expect(assembled(true)).toContain('PARALLEL WORK');
    });

    it('게이트 OFF 면 붙지 않는다 — 없는 도구를 권하지 않는다', () => {
        expect(assembled(false)).not.toContain('PARALLEL WORK');
    });

    it('기본 프롬프트 자체에는 병렬 언급이 없다(안내는 조건부 블록으로만)', () => {
        const base = loadPrompt().getAgentTaskSystemPrompt();
        expect(base).not.toContain('spawn_agents');
    });
});
