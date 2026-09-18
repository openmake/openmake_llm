/**
 * 채팅 사용자 확인 질문(ask_user) 회귀 테스트 (2026-09-15).
 *
 * 배경: 아티팩트 요청에서 모델이 본문으로 되물어 놓고 그대로 진행해 사용자가 답할 길이 없었다
 * (생성 중엔 입력창이 잠긴다). ask_user 호출은 도구를 실행하지 않고 질문을 답변으로 내보낸 뒤
 * 턴을 끝내야 하며, 노출은 아티팩트·보고서 의도 턴에만 해야 한다.
 */
import { buildExternalToolPlan } from '../external-tool-plan';
import { runExternalStream } from '../external-provider';
import { buildSubagentTools } from '../chat-delegate';
import { ASK_USER_TOOL_NAME, buildAskUserTool, findAskUserCall, formatAskUserQuestion } from '../ask-user';
import { CHAT_ASK_USER } from '../../../config/runtime-limits';
import type { ChatMessageRequest } from '../../chat-service-types';
import type { ResolvedProvider } from '../../../providers/provider-router';
import type { ToolDefinition } from '../../../llm';

const webSearchTool: ToolDefinition = {
    type: 'function',
    function: { name: 'web_search', description: 'search', parameters: { type: 'object', properties: {} } },
};

describe('buildExternalToolPlan — ask_user 노출 게이팅', () => {
    const base = {
        allowedTools: [webSearchTool],
        toolCalling: true,
        orchestration: { contributedTools: [], taskDelegate: false },
    };
    const names = (msg: string, toolCalling = true) => buildExternalToolPlan({
        ...base, toolCalling, req: { message: msg } as ChatMessageRequest,
    }).tools.map((t) => t.function.name);

    it('아티팩트 의도 턴에만 노출한다', () => {
        expect(names('한국, 미국, 중국 현재 시간을 보여주는 시계를 html 로 작성해')).toContain(ASK_USER_TOOL_NAME);
        expect(names('미국 시간 알려줘')).not.toContain(ASK_USER_TOOL_NAME);
    });

    it('아티팩트 토글이 켜진 턴에도 노출한다', () => {
        const plan = buildExternalToolPlan({ ...base, req: { message: '시계', artifactMode: true } as ChatMessageRequest });
        expect(plan.tools.map((t) => t.function.name)).toContain(ASK_USER_TOOL_NAME);
    });

    it('모델이 도구 호출을 못 하면 노출하지 않는다', () => {
        expect(names('html 로 작성해', false)).not.toContain(ASK_USER_TOOL_NAME);
    });
});

describe('formatAskUserQuestion / findAskUserCall', () => {
    it('질문 본문을 다듬고 상한을 넘으면 절단한다', () => {
        expect(formatAskUserQuestion({ question: '  어느 도시인가요?\n1. 뉴욕\n2. LA  ' })).toBe('어느 도시인가요?\n1. 뉴욕\n2. LA');
        const long = 'x'.repeat(CHAT_ASK_USER.MAX_CHARS + 10);
        const out = formatAskUserQuestion({ question: long });
        expect(out.length).toBe(CHAT_ASK_USER.MAX_CHARS + 1);
        expect(out.endsWith('…')).toBe(true);
    });

    it('문자열이 아니거나 비어 있으면 질문으로 보지 않는다', () => {
        expect(formatAskUserQuestion({ question: '   ' })).toBe('');
        expect(formatAskUserQuestion({ question: 42 })).toBe('');
        expect(formatAskUserQuestion(null)).toBe('');
        expect(findAskUserCall([{ id: '1', name: ASK_USER_TOOL_NAME, args: { question: '' } }])).toBeUndefined();
        expect(findAskUserCall([{ id: '1', name: 'web_search', args: { query: 'q' } }])).toBeUndefined();
    });
});

describe('서브에이전트 도구 서브셋 — ask_user 제외', () => {
    it('delegate_expert 서브 루프에 ask_user 를 물려주지 않는다', () => {
        const names = buildSubagentTools([webSearchTool, buildAskUserTool()]).map((t) => t.function.name);
        expect(names).toEqual(['web_search']);
    });
});

describe('runExternalStream — ask_user 호출은 질문으로 턴을 끝낸다', () => {
    type StreamImpl = (
        opts: { tools?: ToolDefinition[]; messages: unknown[] },
        cb: { onToken?: (t: string) => void },
    ) => Promise<unknown>;

    function makeResolved(streamChat: StreamImpl): ResolvedProvider {
        return {
            providerId: 'local-llm',
            modelId: 'qwen3.8-27b',
            fullId: 'local-llm:qwen3.8-27b',
            provider: {
                id: 'local-llm',
                sdkType: 'local-llm',
                displayName: 'local',
                getCapabilities: () => ({ streaming: true, toolCalling: true, vision: false, thinking: false }),
                listModels: async () => [],
                validateCredentials: async () => ({ ok: true }),
                streamChat,
            },
        } as unknown as ResolvedProvider;
    }

    const deps = {
        currentUserContext: null,
        allowedTools: [webSearchTool],
        providerRouter: { getExternalKeysRepo: () => undefined },
    } as never;
    const req = {
        message: '한국, 미국, 중국 현재 시간을 보여주는 시계를 html 로 작성해',
        userId: 'u1', userRole: 'user',
    } as unknown as ChatMessageRequest;

    it('도구를 실행하지 않고 질문을 본문으로 내보낸 뒤 추가 LLM 호출 없이 끝난다', async () => {
        const streamChat = jest.fn<ReturnType<StreamImpl>, Parameters<StreamImpl>>(async (opts, cb) => {
            expect(opts.tools?.map((t) => t.function.name)).toContain(ASK_USER_TOOL_NAME);
            cb.onToken?.('미국은 시간대가 여러 개입니다.');
            return {
                content: '미국은 시간대가 여러 개입니다.',
                toolCalls: [
                    { id: 'c1', name: ASK_USER_TOOL_NAME, args: { question: '어느 도시 기준으로 할까요?\n1. 뉴욕\n2. 로스앤젤레스' } },
                    { id: 'c2', name: 'web_search', args: { query: '미국 시간대' } },
                ],
                usage: {},
                finishReason: 'tool_calls',
            };
        });
        const tokens: string[] = [];
        const out = await runExternalStream(deps, makeResolved(streamChat), req, (t) => { if (t) tokens.push(t); });

        expect(streamChat).toHaveBeenCalledTimes(1);
        expect(out).toBe('미국은 시간대가 여러 개입니다.\n\n어느 도시 기준으로 할까요?\n1. 뉴욕\n2. 로스앤젤레스');
        expect(tokens.join('')).toBe(out);
    });

    it('본문 없이 질문만 오면 구분 개행 없이 질문이 곧 답변이다', async () => {
        const streamChat = jest.fn<ReturnType<StreamImpl>, Parameters<StreamImpl>>(async () => ({
            content: '',
            toolCalls: [{ id: 'c1', name: ASK_USER_TOOL_NAME, args: { question: '어느 도시인가요?' } }],
            usage: {},
            finishReason: 'tool_calls',
        }));
        const ctx: Parameters<typeof runExternalStream>[4] = {};
        const out = await runExternalStream(deps, makeResolved(streamChat), req, () => {}, ctx);
        expect(streamChat).toHaveBeenCalledTimes(1);
        expect(out).toBe('어느 도시인가요?');
        // 본문 없이 질문만 나간 턴도 첫 청크 시각이 찍혀야 [ChatTiming] ttfc 가 -1 이 되지 않는다.
        expect(ctx.timings?.firstChunkAt).toBeGreaterThan(0);
    });
});
