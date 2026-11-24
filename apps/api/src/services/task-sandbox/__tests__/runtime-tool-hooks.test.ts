/**
 * task 도구 훅 (AGENT_TASK_TOOL_HOOKS, 하네스 검토 C-08) — 켜면 executeTaskTool 이 pre/post 훅을 지난다.
 * pre 는 승인 판정 전(거절이면 승인을 묻지 않음), post 는 핸들러 결과. 끄면(기본) 훅을 부르지 않는다.
 */
import { __setChatTurnIntegrationsForTest } from '../../chat-service/turn-integrations';
beforeAll(() => __setChatTurnIntegrationsForTest([]));
afterAll(() => __setChatTurnIntegrationsForTest(null));

import { TaskRuntime } from '../runtime';
import { getApprovalRegistry } from '../approval-gate';
import { getTaskSandboxConfig } from '../../../config/task-sandbox';
import { AGENT_TASK_LIMITS } from '../../../config/runtime-limits';
import { registerToolHook, __resetToolHooksForTest, hookFailureDenyMessage, type ToolHookContext } from '../../../tool-contract/tool-hooks';

const cfgNone = { ...getTaskSandboxConfig(), approvalPolicy: 'none' as const };
const cfgAll = { ...getTaskSandboxConfig(), approvalPolicy: 'all' as const };
const terminate = { status: 'success', summary: 'done' };

afterEach(() => { __resetToolHooksForTest(); jest.restoreAllMocks(); });

describe('task 도구 훅 — 꺼짐(기본)', () => {
    it('훅을 부르지 않는다', async () => {
        jest.replaceProperty(AGENT_TASK_LIMITS, 'TOOL_HOOKS_ON_TASK_TOOLS', false);
        const pre = jest.fn(); const post = jest.fn();
        registerToolHook({ id: 'spy', pre, post });
        const out = await new TaskRuntime('th-off', 'u1', cfgNone).executeTaskTool('terminate', terminate);
        expect(out).toContain('__TASK_TERMINATE__');
        expect(pre).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
    });
});

describe('task 도구 훅 — 켜짐', () => {
    beforeEach(() => { jest.replaceProperty(AGENT_TASK_LIMITS, 'TOOL_HOOKS_ON_TASK_TOOLS', true); });

    it('pre·post 가 surface=task 문맥으로 불리고, post 가 결과를 바꿀 수 있다', async () => {
        const seen: ToolHookContext[] = [];
        registerToolHook({
            id: 'spy',
            pre: (_a, c) => { seen.push({ ...c }); },
            post: (_r, c) => { seen.push({ ...c }); return { content: [{ type: 'text', text: 'REDACTED' }] }; },
        });
        const out = await new TaskRuntime('th-on', 'u1', cfgNone).executeTaskTool('terminate', terminate);
        expect(out).toBe('REDACTED');
        expect(seen).toHaveLength(2);
        expect(seen[0]).toMatchObject({ name: 'terminate', surface: 'task', userId: 'u1', external: false });
    });

    it('pre 가 거절하면 핸들러도, 승인 요청도 없다', async () => {
        const requestSpy = jest.spyOn(getApprovalRegistry(), 'request');
        const before = jest.fn(async () => undefined);
        registerToolHook({ id: 'no-shell', pre: (_a, c) => (c.name === 'bash' ? { deny: '셸 금지' } : undefined) });
        const out = await new TaskRuntime('th-deny', 'u1', cfgAll).executeTaskTool('bash', { command: 'ls' }, { onBeforeExecute: before });
        expect(out).toBe('Error: 도구 "bash" 호출이 정책 훅에 의해 거절되었습니다: 셸 금지');
        expect(requestSpy).not.toHaveBeenCalled();
        expect(before).not.toHaveBeenCalled();
    });

    it('pre 가 바꾼 인자로 승인을 묻는다(승인 카드 = 실제 실행 인자)', async () => {
        let asked: Record<string, unknown> | undefined;
        jest.spyOn(getApprovalRegistry(), 'request').mockImplementation(async (req) => {
            asked = req.args as Record<string, unknown>;
            return { decision: 'rejected', reason: 'user', waitedMs: 0 } as Awaited<ReturnType<ReturnType<typeof getApprovalRegistry>['request']>>;
        });
        registerToolHook({ id: 'rewrite', pre: (a) => ({ args: { ...a, command: 'ls -la' } }) });
        await new TaskRuntime('th-rewrite', 'u1', cfgAll).executeTaskTool('bash', { command: 'ls' });
        expect(asked).toMatchObject({ command: 'ls -la' });
    });

    it('fail-closed 훅이 예외를 던지면 실행하지 않는다', async () => {
        const before = jest.fn(async () => undefined);
        registerToolHook({ id: 'scan', failClosed: true, pre: () => { throw new Error('down'); } });
        const out = await new TaskRuntime('th-fc', 'u1', cfgNone).executeTaskTool('terminate', terminate, { onBeforeExecute: before });
        expect(out).toContain(hookFailureDenyMessage('scan'));
        expect(before).not.toHaveBeenCalled();
    });

    it('ask_human 은 훅을 지나지 않는다(도구가 곧 사용자 질문)', async () => {
        const pre = jest.fn();
        registerToolHook({ id: 'spy', pre });
        jest.spyOn(getApprovalRegistry(), 'request').mockResolvedValue(
            { decision: 'approved', waitedMs: 0, text: '네' } as Awaited<ReturnType<ReturnType<typeof getApprovalRegistry>['request']>>,
        );
        const out = await new TaskRuntime('th-ask', 'u1', cfgNone).executeTaskTool('ask_human', { question: '진행할까요?' });
        expect(out).toContain('네');
        expect(pre).not.toHaveBeenCalled();
    });
});
