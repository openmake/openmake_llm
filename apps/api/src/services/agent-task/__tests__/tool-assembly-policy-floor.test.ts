/**
 * 정책 none 의 정적 금지 도구 노출 제외(#1470) — 인자와 무관하게 floorDeniedUnderPolicy('none', name, {}) 가 거절하는
 * 외부 MCP 도구(server::tool·mcp_call)만 모델 목록에서 뺀다. memory_save·사이트 쓰기 같은 "묻는" 예외와
 * 인자에 따라 갈리는 file_ops·str_replace_editor, 읽기·제어 도구는 남는다. 실행 시점 방어는 그대로다.
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
jest.mock('../../../security/security-audit', () => ({ auditSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));

import { assembleAgentTools } from '../tool-assembly';
import { ApprovalRegistry } from '../../task-sandbox/approval-gate';
import type { ToolDefinition } from '../../../llm/types';
import type { TaskRuntime } from '../../task-sandbox/runtime';
import type { TaskSandboxApprovalPolicy, TaskSandboxConfig } from '../../../config/task-sandbox';

const tool = (name: string): ToolDefinition => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } }) as ToolDefinition;
const catalog = [tool('web_search'), tool('srv::create_item'), tool('srv::search_docs'), tool('mcp_call'), tool('mcp_list_tools'), tool('load_skill'), tool('ask_human')];
const runtime = { getLLMTools: () => ['bash', 'file_ops', 'str_replace_editor', 'memory_save', 'browser', 'plan_update'].map(tool) } as unknown as TaskRuntime;
const cfg = (approvalPolicy: TaskSandboxApprovalPolicy, o: { enabled?: boolean; internalOnly?: boolean } = {}) =>
    ({ enabled: o.enabled ?? true, extraTools: ['web_search', 'srv::create_item'], internalOnly: o.internalOnly ?? false, approvalPolicy }) as unknown as TaskSandboxConfig;
const names = (r: { tools: ToolDefinition[] }) => r.tools.map((t) => t.function.name).sort();
const DENIED = ['mcp_call', 'srv::create_item', 'srv::search_docs'];

describe('assembleAgentTools — 정책 none 정적 금지 도구', () => {
    it('샌드박스 ON: none 이면 외부 MCP 도구가 정적·동적 어느 경로로도 보이지 않는다', async () => {
        const r = await assembleAgentTools({ mcpTools: catalog, taskRuntime: runtime, sandboxCfg: cfg('none'), goal: 'g' });
        expect(names(r)).toEqual(['ask_human', 'bash', 'browser', 'file_ops', 'load_skill', 'mcp_list_tools', 'memory_save', 'plan_update', 'str_replace_editor', 'web_search']);
        for (const n of DENIED) expect(r.extraToolNames.has(n)).toBe(false);
    });

    it.each(['high-risk', 'all'] as const)('샌드박스 ON: %s 는 외부 MCP 도구를 그대로 노출한다', async (policy) => {
        const r = await assembleAgentTools({ mcpTools: catalog, taskRuntime: runtime, sandboxCfg: cfg(policy), goal: 'g' });
        expect(names(r)).toEqual(expect.arrayContaining(DENIED));
    });

    it('샌드박스 degrade(활성인데 실행 환경 없음): none 이면 화이트리스트의 외부 MCP 도구도 뺀다', async () => {
        const r = await assembleAgentTools({ mcpTools: catalog, taskRuntime: null, sandboxCfg: cfg('none'), goal: 'g' });
        expect(names(r)).toEqual(['web_search']);
        expect([...r.extraToolNames]).toEqual(['web_search']);
    });

    it('샌드박스 OFF(legacy): none 이면 외부 MCP 도구만 빠지고 나머지 카탈로그는 남는다', async () => {
        const r = await assembleAgentTools({ mcpTools: catalog, taskRuntime: null, sandboxCfg: cfg('none', { enabled: false }), goal: 'g' });
        expect(names(r)).toEqual(['ask_human', 'load_skill', 'mcp_list_tools', 'web_search']);
        expect([...r.extraToolNames].sort()).toEqual(names(r));
    });

    it('샌드박스 OFF(legacy): high-risk 는 카탈로그 전체를 노출한다', async () => {
        const r = await assembleAgentTools({ mcpTools: catalog, taskRuntime: null, sandboxCfg: cfg('high-risk', { enabled: false }), goal: 'g' });
        expect(names(r)).toEqual(catalog.map((t) => t.function.name).sort());
    });

    it('내부 전용 + none: 두 필터가 함께 적용되고 내부 전용 감사 목록은 종전과 같다', async () => {
        const r = await assembleAgentTools({ mcpTools: catalog, taskRuntime: runtime, sandboxCfg: cfg('none', { internalOnly: true }), goal: 'g' });
        for (const n of DENIED) expect(names(r)).not.toContain(n);
        expect(names(r)).toContain('memory_save');
        expect(r.removedForInternalOnly).toEqual(expect.arrayContaining(['srv::create_item', 'mcp_call']));
    });

    it('목록에서 빠진 외부 MCP 도구를 직접 호출해도 실행 시점 게이트가 거절한다', async () => {
        const r = await new ApprovalRegistry().request(
            { taskId: 't1', userId: 'u1', toolName: 'srv::create_item', args: {} },
            { timeoutMs: 1000, policy: 'none' },
        );
        expect(r).toMatchObject({ decision: 'rejected', reason: 'policy_floor' });
    });
});

describe('assembleAgentTools — APPROVAL_FLOOR 설정 존중', () => {
    it('third_party_tool 이 바닥에 없으면 none 에서도 외부 MCP 도구를 숨기지 않는다', async () => {
        const prev = process.env.AGENT_TASK_APPROVAL_FLOOR;
        process.env.AGENT_TASK_APPROVAL_FLOOR = 'memory_write';
        try {
            let assemble!: typeof assembleAgentTools;
            jest.isolateModules(() => { assemble = (jest.requireActual('../tool-assembly') as typeof import('../tool-assembly')).assembleAgentTools; });
            const r = await assemble({ mcpTools: catalog, taskRuntime: null, sandboxCfg: cfg('none', { enabled: false }), goal: 'g' });
            expect(names(r)).toEqual(catalog.map((t) => t.function.name).sort());
        } finally {
            if (prev === undefined) delete process.env.AGENT_TASK_APPROVAL_FLOOR; else process.env.AGENT_TASK_APPROVAL_FLOOR = prev;
        }
    });
});
