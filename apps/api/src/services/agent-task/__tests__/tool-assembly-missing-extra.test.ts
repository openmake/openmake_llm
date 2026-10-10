/**
 * 카탈로그에 없는 extraTools 경고 — 같은 이름은 프로세스당 한 번만 warn, 그 뒤로는 debug.
 */
jest.mock('../../../utils/logger', () => {
    const shared = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { createLogger: () => shared, __shared: shared };
});
jest.mock('../../../runtime-ports/skill-runtime', () => ({
    LOAD_SKILL_TOOL_NAME: 'load_skill',
    getSkillRuntime: () => ({ applyCatalogToTools: async (tools: unknown[]) => tools }),
}));
jest.mock('../tool-selector', () => ({ selectRelevantTools: () => [] }));
jest.mock('../tool-selector-embedding', () => ({ selectRelevantToolsEmbedding: async () => [] }));

import { assembleAgentTools, __resetMissingExtraToolWarningsForTest } from '../tool-assembly';
import type { ToolDefinition } from '../../../llm/types';
import type { TaskRuntime } from '../../task-sandbox/runtime';
import type { TaskSandboxConfig } from '../../../config/task-sandbox';

const logger = (jest.requireMock('../../../utils/logger') as { __shared: { warn: jest.Mock; debug: jest.Mock } }).__shared;
const tool = (name: string): ToolDefinition => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } }) as ToolDefinition;
const runtime = { getLLMTools: () => [tool('bash')] } as unknown as TaskRuntime;
const cfg = (extraTools: string[]) => ({ enabled: true, extraTools, internalOnly: false }) as unknown as TaskSandboxConfig;
const run = (extraTools: string[]) => assembleAgentTools({ mcpTools: [tool('web_search')], taskRuntime: runtime, sandboxCfg: cfg(extraTools), goal: 'g' });
const missingWarns = () => logger.warn.mock.calls.filter(([m]) => String(m).includes('도구 카탈로그에서 찾지 못함'));
const missingDebugs = () => logger.debug.mock.calls.filter(([m]) => String(m).includes('도구 카탈로그에서 찾지 못함'));

beforeEach(() => {
    jest.clearAllMocks();
    __resetMissingExtraToolWarningsForTest();
});

describe('assembleAgentTools — 카탈로그에 없는 extraTools', () => {
    it('같은 이름은 첫 작업에서만 warn, 다음 작업부터는 debug', async () => {
        await run(['open-design::list_projects']);
        await run(['open-design::list_projects']);
        expect(missingWarns()).toHaveLength(1);
        expect(missingWarns()[0][0]).toContain('TASK_SANDBOX_EXTRA_TOOLS');
        expect(missingDebugs()).toHaveLength(1);
    });

    it('다른 이름은 각각 warn', async () => {
        await run(['a::x']);
        await run(['b::y']);
        expect(missingWarns()).toHaveLength(2);
        expect(missingDebugs()).toHaveLength(0);
    });

    it('카탈로그에 있는 이름은 경고 없이 합류한다', async () => {
        const r = await run(['web_search']);
        expect(r.tools.map((t) => t.function.name)).toContain('web_search');
        expect(missingWarns()).toHaveLength(0);
    });

    it('리셋하면 다시 warn 한다', async () => {
        await run(['a::x']);
        __resetMissingExtraToolWarningsForTest();
        await run(['a::x']);
        expect(missingWarns()).toHaveLength(2);
    });
});
