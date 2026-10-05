/**
 * 도구 조립의 내부 전용 (Companion P1-5) — 호스트에서 도는 추가 도구는 허용 목록만 남고, 작업 도구는 그대로다.
 */
jest.mock('../../../runtime-ports/skill-runtime', () => ({
    LOAD_SKILL_TOOL_NAME: 'load_skill',
    getSkillRuntime: () => ({ applyCatalogToTools: async (tools: unknown[]) => tools }),
}));
jest.mock('../tool-selector', () => ({ selectRelevantTools: (_g: string, all: Array<{ function: { name: string } }>, o: { exclude: Set<string> }) => all.filter((t) => !o.exclude.has(t.function.name)) }));
jest.mock('../tool-selector-embedding', () => ({ selectRelevantToolsEmbedding: async () => [] }));
jest.mock('../../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../../config/runtime-limits');
    return { ...actual, AGENT_TASK_LIMITS: { ...actual.AGENT_TASK_LIMITS, DYNAMIC_TOOLS_ENABLED: true, DYNAMIC_TOOLS_BUDGET: 40, DYNAMIC_TOOLS_MODE: 'keyword' } };
});

import { assembleAgentTools } from '../tool-assembly';
import type { ToolDefinition } from '../../../llm/types';
import type { TaskRuntime } from '../../task-sandbox/runtime';
import type { TaskSandboxConfig } from '../../../config/task-sandbox';

const tool = (name: string): ToolDefinition => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } }) as ToolDefinition;
const catalog = [tool('web_search'), tool('load_skill'), tool('github::create_issue'), tool('web_fetch')];
const runtime = { getLLMTools: () => [tool('bash'), tool('file_ops')] } as unknown as TaskRuntime;
const cfg = (internalOnly: boolean) => ({ enabled: true, extraTools: ['web_search'], internalOnly }) as unknown as TaskSandboxConfig;
const names = (r: { tools: ToolDefinition[] }) => r.tools.map((t) => t.function.name).sort();

describe('assembleAgentTools — 내부 전용', () => {
    it('내부 전용이면 검색·외부 MCP 도구가 모델에 보이지 않는다', async () => {
        const r = await assembleAgentTools({ mcpTools: catalog, taskRuntime: runtime, sandboxCfg: cfg(true), goal: 'g' });
        expect(names(r)).toEqual(['bash', 'file_ops', 'load_skill']);
        expect([...r.extraToolNames]).toEqual(['load_skill']);
        expect(r.removedForInternalOnly.sort()).toEqual(['github::create_issue', 'web_fetch', 'web_search']);
    });

    it('내부 전용이 아니면 종전대로 추가 도구가 합류한다', async () => {
        const r = await assembleAgentTools({ mcpTools: catalog, taskRuntime: runtime, sandboxCfg: cfg(false), goal: 'g' });
        expect(names(r)).toEqual(['bash', 'file_ops', 'github::create_issue', 'load_skill', 'web_fetch', 'web_search']);
        expect(r.removedForInternalOnly).toEqual([]);
    });

    it('실행 환경 없이 진행하는 분기에서도 외부 도구를 내보내지 않는다', async () => {
        const r = await assembleAgentTools({ mcpTools: catalog, taskRuntime: null, sandboxCfg: cfg(true), goal: 'g' });
        expect(names(r)).toEqual([]);
    });

    it('샌드박스가 꺼진 종전 경로에서도 허용 목록만 남는다', async () => {
        const r = await assembleAgentTools({ mcpTools: catalog, taskRuntime: null, sandboxCfg: { ...cfg(true), enabled: false } as TaskSandboxConfig, goal: 'g' });
        expect(names(r)).toEqual(['load_skill']);
    });
});
