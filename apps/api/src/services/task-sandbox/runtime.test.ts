// add-on 기여 도구 고정 — 운영 .env 가 add-on 의 작업 도구(예: 토론, AGENT_TASK_DISCUSSION)를 켜면 도구 수가 늘어
// 아래 base 13종 단언이 깨진다. Base 계약을 검증하는 테스트이므로 통합을 0개로 고정해 env·add-on 과 무관하게 한다.
// (기여 도구의 노출 자체는 addons/discussion/__tests__/agent-task-tool.test.ts 가 검증)
import { __setChatTurnIntegrationsForTest } from '../chat-service/turn-integrations';

beforeAll(() => __setChatTurnIntegrationsForTest([]));
afterAll(() => __setChatTurnIntegrationsForTest(null));

import { toLLMTool, TaskRuntime } from './runtime';
import * as approvalGate from './approval-gate';
import { getApprovalRegistry } from './approval-gate';
import { AgentTaskParked } from '../agent-task/types';
import { getTaskSandboxConfig } from '../../config/task-sandbox';
import type { MCPToolDefinition } from '../../tool-contract/types';

describe('toLLMTool 어댑터', () => {
    it('MCPToolDefinition → LLM ToolDefinition 변환', () => {
        const def: MCPToolDefinition = {
            tool: {
                name: 'bash',
                description: '셸 실행',
                inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
            },
            handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
        };
        const t = toLLMTool(def);
        expect(t.type).toBe('function');
        expect(t.function.name).toBe('bash');
        expect(t.function.parameters.properties.command.type).toBe('string');
    });
});

describe('TaskRuntime 도구/게이트 (샌드박스 미생성 — 게이트 로직만)', () => {
    const cfgAll = { ...getTaskSandboxConfig(), approvalPolicy: 'all' as const };
    const cfgNone = { ...getTaskSandboxConfig(), approvalPolicy: 'none' as const };

    it('getLLMTools 13종 + isTaskTool', () => {
        const rt = new TaskRuntime('t1', 'u1', cfgNone);
        // 절차 스킬 도구(skill_save/skill_run)는 AGENT_TASK_PROCEDURAL_SKILLS 플래그 게이트라 제외하고 base 11 검증.
        const names = rt.getLLMTools().map((t) => t.function.name).filter((n) => n !== 'skill_save' && n !== 'skill_run');
        expect(names).toEqual(['bash', 'python_execute', 'str_replace_editor', 'file_ops', 'grep_code', 'repo_map', 'browser', 'plan_create', 'plan_update', 'plan_view', 'delegate', 'terminate', 'ask_human']);
        expect(rt.isTaskTool('bash')).toBe(true);
        expect(rt.isTaskTool('web_search')).toBe(false);
    });

    it('정책 all — bash 는 승인 대기, reject 시 거절 메시지', async () => {
        const rt = new TaskRuntime('t-approve', 'u1', cfgAll);
        let approvalId = '';
        const exec = rt.executeTaskTool('bash', { command: 'ls' }, {
            onApprovalPending: (p) => { approvalId = p.approvalId; },
        });
        // 승인 대기 진입 — 잠깐 양보 후 reject
        await new Promise((r) => setImmediate(r));
        expect(approvalId).toBeTruthy();
        getApprovalRegistry().reject(approvalId);
        const out = await exec;
        expect(out).toContain('승인하지 않았습니다');
    });

    it('제어 시그널(terminate)은 승인 불요 — 즉시 실행', async () => {
        const rt = new TaskRuntime('t-term', 'u1', cfgAll);
        const out = await rt.executeTaskTool('terminate', { status: 'success', summary: 'done' });
        expect(out).toContain('__TASK_TERMINATE__');
    });

    it('ask_human 은 정책 none 이어도 항상 사용자 응답 대기 — approve 시 계속 진행 안내', async () => {
        const rt = new TaskRuntime('t-ask', 'u1', cfgNone);
        let approvalId = '';
        const exec = rt.executeTaskTool('ask_human', { question: '계속할까요?' }, {
            onApprovalPending: (p) => { approvalId = p.approvalId; },
        });
        await new Promise((r) => setImmediate(r));
        expect(approvalId).toBeTruthy();
        getApprovalRegistry().approve(approvalId);
        const out = await exec;
        expect(out).toContain('승인');
        expect(out).toContain('계속할까요?');
        expect(out).not.toContain('__TASK_ASK_HUMAN__'); // sentinel 이 대화로 새지 않음
    });

    it('ask_human 만료가 주차(parked)면 결과 대신 AgentTaskParked 를 던진다(F16.7)', async () => {
        const rt = new TaskRuntime('t-ask-park', 'u1', cfgNone);
        const spy = jest.spyOn(approvalGate, 'getApprovalRegistry').mockReturnValue({
            request: async () => ({ decision: 'rejected', reason: 'parked', waitedMs: 3 }),
        } as unknown as ReturnType<typeof approvalGate.getApprovalRegistry>);
        const rejected = jest.fn();
        const waited = jest.fn();
        await expect(rt.executeTaskTool('ask_human', { question: 'q' }, { onApprovalRejected: rejected, onApprovalWaited: waited }))
            .rejects.toBeInstanceOf(AgentTaskParked);
        expect(waited).toHaveBeenCalledWith(3);
        expect(rejected).not.toHaveBeenCalled(); // 무응답 강등 카운트 대상이 아니다
        spy.mockRestore();
    });

    it('ask_human 거절 시 대안 유도 메시지', async () => {
        const rt = new TaskRuntime('t-ask-rej', 'u1', cfgAll);
        let approvalId = '';
        const exec = rt.executeTaskTool('ask_human', { question: 'q' }, {
            onApprovalPending: (p) => { approvalId = p.approvalId; },
        });
        await new Promise((r) => setImmediate(r));
        getApprovalRegistry().reject(approvalId);
        const out = await exec;
        expect(out).toContain('거절');
    });
});

describe('도구 이름 교정 (P0-b)', () => {
    const cfgNone = { ...getTaskSandboxConfig(), approvalPolicy: 'none' as const };

    it('알 수 없는 도구 이름에 후보를 붙인다 — Claude Code 별칭', async () => {
        const rt = new TaskRuntime('t-alias', 'u1', cfgNone);
        const out = await rt.executeTaskTool('Read', {});
        expect(out).toContain('알 수 없는 task 도구 Read');
        expect(out).toContain('file_ops');
    });

    it('노출 도구 목록을 주입하면 MCP·내장 도구도 후보가 된다', async () => {
        const rt = new TaskRuntime('t-known', 'u1', cfgNone);
        rt.setKnownToolNames(['web_search', 'extract_webpage']);
        const out = await rt.executeTaskTool('web-search', {});
        expect(out).toContain('web_search');
    });

    it('후보가 없으면 종전 메시지 그대로 (fail-open)', async () => {
        const rt = new TaskRuntime('t-none', 'u1', cfgNone);
        const out = await rt.executeTaskTool('zzzzzzzzzzzz', {});
        expect(out).toBe('Error: 알 수 없는 task 도구 zzzzzzzzzzzz');
    });
});
