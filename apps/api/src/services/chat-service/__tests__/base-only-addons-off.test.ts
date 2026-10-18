/**
 * 선택 add-on 을 모두 끈 기본 채팅 — 통합 0개, 도구·스킬 포트 미등록, 기여 도구 해제 상태에서
 * 채팅 경로가 부르는 경계 함수가 중립값을 돌려주고 던지지 않는다(설계 3차 §2 C1 "모든 선택 add-on 을 끈 기본 채팅 fixture").
 */
const integrationGate = jest.fn(async () => ({ allowed: true }));
jest.mock('../../addon/integration-gate', () => ({ integrationGate: () => integrationGate() }));
jest.mock('../../addon/addon-state', () => ({ isAddonEnabledSync: () => true }));

import {
    __setChatTurnIntegrationsForTest, collectContextRefs, collectHiddenSessionIds, collectIntegrationSystemPromptParts,
    collectTurnContexts, detectIntegrationIntents, extractIntegrationBlocks, getActiveAgentTaskTools, getActiveChatTurnIntegrations,
    isSessionMemoryIsolated, type IntegrationBlocks,
} from '../turn-integrations';
import { createTaskTools } from '../../task-sandbox/tools';
import { TaskPlan } from '../../task-sandbox/planning';
import type { TaskExecutor } from '../../task-sandbox/executor';
import { getToolRuntime, isExternalToolRuntimeRegistered, resetToolRuntime } from '../../../runtime-ports/tool-runtime';
import { getSkillRuntime, isSkillRuntimeRegistered, resetSkillRuntime } from '../../../runtime-ports/skill-runtime';
import {
    contributeBuiltInTools, resetBuiltInToolContributions, unregisterToolContributions,
} from '../../../runtime-ports/builtin-tool-contributions';
import type { MCPToolDefinition } from '../../../tool-contract/types';

const ADDON_TOOL_NAMES = ['load_skill', 'create_skill', 'mcp_list_tools', 'mcp_call'];

beforeEach(() => {
    __setChatTurnIntegrationsForTest([]);
    resetToolRuntime();
    resetSkillRuntime();
    resetBuiltInToolContributions();
    integrationGate.mockClear();
});
afterEach(() => { __setChatTurnIntegrationsForTest(null); });

describe('선택 add-on 을 모두 끈 기본 채팅', () => {
    it('채팅 통합 훅은 모두 중립값 — 컨텍스트·출처·프롬프트 조각·의도·숨김 없음, 격리 아님', async () => {
        expect(getActiveChatTurnIntegrations()).toEqual([]);
        expect(await collectTurnContexts({ userId: 'u1', sessionId: 's1', message: '안녕', userLang: 'ko' }))
            .toEqual({ contextBlock: '', sources: [], systemPromptPart: '' });
        expect(integrationGate).not.toHaveBeenCalled();
        expect(await isSessionMemoryIsolated('u1', 's1')).toBe(false);
        expect([...(await collectHiddenSessionIds('u1'))]).toEqual([]);
        expect(detectIntegrationIntents('안녕')).toEqual({});
        expect(collectIntegrationSystemPromptParts({ message: '안녕' })).toEqual([]);
        const blocks: IntegrationBlocks = {};
        expect(extractIntegrationBlocks('도구 결과', blocks)).toBe('도구 결과');
        expect(blocks).toEqual({});
        expect(collectContextRefs({ contextRefs: { 'knowledge-runtime': { id: 'sp1', title: 't' } } })).toBeUndefined();
    });

    it('도구 포트는 내장 도구만 — add-on 도구 없음, 외부 호출은 null, 정규화는 그대로', async () => {
        expect(isExternalToolRuntimeRegistered()).toBe(false);
        const runtime = getToolRuntime();
        const names = (await runtime.listLLMTools({ userId: 'u1' })).map((t) => t.function.name);
        expect(names).toContain('vision_ocr');
        for (const n of ADDON_TOOL_NAMES) expect(names).not.toContain(n);
        expect(await runtime.callUserServerTool('u1', 'srv', 'tool', {})).toBeNull();
        expect(runtime.normalizeToolCall('web_search', { q: 'x' })).toEqual({ name: 'web_search', args: { q: 'x' } });
        expect(runtime.getUserToolGroups('u1')).toEqual([]);
        await expect(runtime.onChatStart('u1', 'c1')).resolves.toBeUndefined();
    });

    it('스킬 포트는 NULL 구현 — 매니페스트 없음, 프롬프트 빈 문자열, 주입 0', async () => {
        expect(isSkillRuntimeRegistered()).toBe(false);
        const skills = getSkillRuntime();
        expect(await skills.buildManifestPrompt('general', 'u1')).toBeNull();
        expect(await skills.buildSkillPromptForIds(['s1'], 'u1')).toBe('');
        expect(await skills.getActiveSkillBindings('general', 'u1')).toEqual([]);
        expect(skills.isOfferEnabled()).toBe(false);
    });

    it('정지로 기여 도구가 해제되면 도구 목록에서 빠진다(시작 실패 보상과 같은 경로)', async () => {
        const fake = {
            tool: { name: 'load_skill', description: 'x', inputSchema: { type: 'object', properties: {} } },
            handler: async () => ({ content: [] }),
        } as unknown as MCPToolDefinition;
        contributeBuiltInTools('skill-runtime', [fake]);
        expect((await getToolRuntime().listLLMTools()).map((t) => t.function.name)).toContain('load_skill');
        expect(unregisterToolContributions('skill-runtime')).toBe(1);
        expect((await getToolRuntime().listLLMTools()).map((t) => t.function.name)).not.toContain('load_skill');
    });

    it('에이전트 작업 — 기여 도구 없이 Base 작업 도구만으로 구성된다', () => {
        expect(getActiveAgentTaskTools()).toEqual([]);
        const executor = { label: 'test', localWorkdir: null, exec: jest.fn() } as unknown as TaskExecutor;
        const names = createTaskTools(executor, new TaskPlan(), undefined, undefined, undefined, undefined, getActiveAgentTaskTools(), { userId: 'u1' })
            .map((t) => t.tool.name);
        expect(names).toEqual(expect.arrayContaining(['bash', 'python_execute', 'str_replace_editor', 'file_ops', 'grep_code', 'repo_map',
            'plan_create', 'plan_update', 'plan_view', 'delegate', 'terminate', 'ask_human']));
        expect(names).not.toContain('start_discussion');
    });
});
