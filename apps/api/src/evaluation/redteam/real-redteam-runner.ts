/**
 * real 레드팀 실행기 (F26.6) — ChatService 를 실제로 돌리되 도구는 dry-run 으로 관찰만 한다. 첨부 문서는 실제 첨부 경로로 넣는다.
 * 도구 결과 주입 케이스(toolResult, W3 S4)는 에이전트 작업 대화를 직접 조립해 주입한 결과 뒤 모델의 다음 턴을 본다 —
 * 채팅 history 는 assistant tool_calls·tool 역할을 싣지 못한다(external-messages). 결과는 운영과 같은 플래그
 * (AGENT_TASK_TOOL_RESULT_WRAP_ENABLED)로 감싸므로, 플래그를 바꿔 두 번 돌리면 래퍼 효과를 잰다.
 *
 * @module evaluation/redteam/real-redteam-runner
 */
import * as fs from 'fs';
import * as path from 'path';
import { LLMClient } from '../../llm';
import { ChatService } from '../../services/ChatService';
import { ProviderRouter } from '../../providers/provider-router';
import { LocalLLMProvider } from '../../providers/local-llm-provider';
import { buildFileContext } from '../../services/chat-service/attach-context';
import type { ChatMessageRequest } from '../../services/chat-service-types';
import type { ChatMessage, ToolDefinition } from '../../llm';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { getAgentTaskSystemPrompt } from '../../prompts/agent-task-prompt';
import { toolOutputSource, wrapUntrustedToolResult } from '../../services/agent-task/tool-result-wrap';
import { createTaskTools } from '../../services/task-sandbox/tools';
import { toLLMTool } from '../../services/task-sandbox/runtime';
import type { TaskExecutor } from '../../services/task-sandbox/executor';
import { REDTEAM_FIXTURE_DIR, type RealRedteamRunner, type RealObservation, type RedteamRealCheck } from './redteam-evaluator';

/** 주입한 도구 호출의 id — assistant tool_calls 와 tool 메시지를 잇는다. */
const INJECTED_TOOL_CALL_ID = 'call_redteam_tool_result';

/** 도구 결과 주입 — 시스템 프롬프트 + 사용자 목표 + 도구 호출 + (래퍼 플래그대로) 결과, 다음 턴의 응답·도구 호출을 관찰(실행 안 함). */
async function observeAfterToolResult(real: RedteamRealCheck & { toolResult: { name: string; content: string } }, signal: AbortSignal): Promise<RealObservation> {
    const { name, content } = real.toolResult;
    // 작업 샌드박스 도구 정의만 쓴다(핸들러는 부르지 않는다) — 모델이 file_ops·bash 를 부르는지 본다.
    const tools: ToolDefinition[] = createTaskTools({ isBrowserEnabled: true } as unknown as TaskExecutor).map(toLLMTool);
    if (!tools.some((t) => t.function.name === name)) tools.push({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } });
    const goal = real.query;
    const messages: ChatMessage[] = [
        { role: 'system', content: getAgentTaskSystemPrompt() },
        { role: 'user', content: goal },
        { role: 'assistant', content: '', tool_calls: [{ type: 'function', id: INJECTED_TOOL_CALL_ID, function: { name, arguments: {} } }] },
        {
            role: 'tool', tool_name: name, tool_call_id: INJECTED_TOOL_CALL_ID,
            content: AGENT_TASK_LIMITS.TOOL_RESULT_WRAP_ENABLED ? wrapUntrustedToolResult(content, goal, toolOutputSource(name, {})) : content,
        },
    ];
    const reply = await new LLMClient({}).chat(messages, undefined, undefined, { tools, signal });
    return { response: reply.content ?? '', toolCalls: (reply.tool_calls ?? []).map((t) => ({ name: t.function.name, args: t.function.arguments })) };
}

export function createRealRedteamRunner(opts: { timeoutMs: number }): RealRedteamRunner {
    return async (c) => {
        const { toolResult } = c.real;
        if (toolResult) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
            try {
                return await observeAfterToolResult({ ...c.real, toolResult }, controller.signal);
            } finally {
                clearTimeout(timer);
            }
        }
        const client = new LLMClient({});
        const chatService = new ChatService(client, new ProviderRouter({ localProvider: new LocalLLMProvider(client) }));
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
        const toolCalls: RealObservation['toolCalls'] = [];
        const doc = c.real.injectedDocument;
        const req: ChatMessageRequest = {
            message: c.real.query,
            history: [],
            userId: 'eval-redteam-runner',
            userRole: c.real.role ?? 'user',
            enabledTools: {},
            abortSignal: controller.signal,
            ...(doc ? { fileContext: buildFileContext([{ name: doc, type: 'text/markdown', content: fs.readFileSync(path.join(REDTEAM_FIXTURE_DIR, doc), 'utf8') }]) } : {}),
            evalToolObserver: { dryRun: true, onToolCalls: (calls) => { toolCalls.push(...calls); } },
        };
        try {
            const response = await chatService.processMessage(req, () => { /* 최종 반환값으로 판정 */ });
            return { response, toolCalls };
        } finally {
            clearTimeout(timer);
        }
    };
}
