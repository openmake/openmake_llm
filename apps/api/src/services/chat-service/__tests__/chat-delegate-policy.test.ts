/**
 * delegate_expert 서브에이전트에 부모 채팅의 실효 승인 정책을 넘긴다(#1469) — skipApprovalGate 는 대화형 대기만 생략하고,
 * 서브의 권한 판정(requiresApproval·바닥)은 부모와 같은 정책으로 한다. 정책을 주지 않는 호출은 종전 기본(none)이다.
 */
const runSubagentMock = jest.fn(async (..._a: unknown[]) => '서브 결과');
jest.mock('../../agent-task/subagent', () => ({ runSubagent: (p: unknown) => runSubagentMock(p) }));
jest.mock('../../../agents/keyword-router', () => ({ routeToAgent: jest.fn(async () => ({ agentId: 'general' })) }));
jest.mock('../../../agents/system-prompt', () => ({ getAgentSystemMessage: jest.fn(async () => ({ prompt: 'persona' })) }));
jest.mock('../../../llm', () => ({ createClient: jest.fn(() => ({ __client: true })) }));
jest.mock('../../../config/model-roles', () => ({ ...jest.requireActual('../../../config/model-roles'), getModelForRole: jest.fn(() => 'test-model') }));

import { runChatDelegate } from '../chat-delegate';

const tool = (name: string) => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } });

beforeEach(() => runSubagentMock.mockClear());

describe('runChatDelegate — 부모 승인 정책 전달', () => {
    it('부모 정책(high-risk)을 서브 sandboxCfg 로 넘기고 게이트 생략은 유지한다', async () => {
        await runChatDelegate({ args: { subgoal: '조사' }, chatTools: [tool('web_search')] as never, userCtx: { userId: 'u1', role: 'user' } as never, parentPolicy: 'high-risk' } as never);
        expect((runSubagentMock.mock.calls[0][0] as { sandboxCfg: unknown }).sandboxCfg).toEqual({ approvalPolicy: 'high-risk', approvalTimeoutMs: 0, skipApprovalGate: true });
    });

    it('정책을 주지 않으면 종전 기본(none)이다', async () => {
        await runChatDelegate({ args: { subgoal: '조사' }, chatTools: [tool('web_search')] as never, userCtx: { userId: 'u1', role: 'user' } as never });
        expect((runSubagentMock.mock.calls[0][0] as { sandboxCfg: { approvalPolicy: string } }).sandboxCfg.approvalPolicy).toBe('none');
    });
});
