/**
 * External Provider 도구 호출 배치 실행.
 *
 * 한 턴의 tool_calls 를 실행해 tool 메시지로 messages 에 싣는다 — 읽기 전용 도구 병렬
 * 선실행, 위임(chat_delegate/spawn_agents)·오케스트레이션 분기와 호출 캡, 그리고 최종
 * 응답에 결정적으로 첨부할 블록(통합 블록·토론 출처·OD 산출물) 수집까지.
 *
 * external-provider 본체(600줄 CI 가드)에서 분리. 배치가 누적하는 값은 호출부 클로저
 * 대신 ToolBatchState 한 객체로 주고받는다.
 *
 * @module services/chat-service/external-tool-batch
 */
import { CHAT_SUBAGENT, AGENT_SPAWN, ORCHESTRATION_DISPATCH, OD_ARTIFACT_ECHO } from '../../config/runtime-limits';
import { extractIntegrationBlocks, type IntegrationBlocks } from './turn-integrations';
import { CHAT_DELEGATE_TOOL_NAME, runChatDelegate } from './chat-delegate';
import { SPAWN_AGENTS_TOOL_NAME, runChatSpawnAgents } from '../agent-spawn/spawn-agents';
import { isOrchestrationTool, runOrchestrationTool } from './orchestration-dispatch';
import { executeExternalTool } from './external-tool-exec';
import { recordDelegatedTask } from './delegated-task-record';
import { captureOdArtifactHtml, normalizeOdToolCall, type OdArtifactCapture } from './external-deterministic-append';
import { prefetchReadOnlyCalls } from '../tool-parallel';
import type { ChatMessage, ToolDefinition } from '../../llm';
import type { ChatMessageRequest } from '../chat-service-types';
import type { ChatStreamResult } from '../../providers/i-provider';
import type { ExternalProviderDeps, StreamFromExternalContext } from './external-provider-types';
import type { SearchSourceRef } from '../../tools/web-search/types';
import { withLanguageNote } from './tool-result-language';
import { CHAT_TOOL_APPROVAL } from '../../config/chat-approval';
import { bringsExternalContent } from '../../config/tool-policy';
import type { TaskSandboxApprovalPolicy } from '../../config/task-sandbox';
import { requiresApproval, stripApprovalGatedTools } from '../task-sandbox/approval-gate';
import { floorDeniedUnderPolicy } from '../task-sandbox/approval-floor';
import { hasChatApprovalChannel, rejectWithoutApprovalChannel, requestChatApproval, resolveChatApprovalPolicy } from './chat-approval';
import { getChatApprovalDeniedResult } from '../../prompts/chat-approval';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ChatToolApproval');

type ExternalToolCall = NonNullable<ChatStreamResult['toolCalls']>[number];

/** 평가 dry-run 도구 결과(F26.2) */
export const EVAL_DRY_RUN_TOOL_RESULT = '[evaluation dry-run] The tool was not executed. Answer briefly without calling more tools.';

/** 도구 루프 전체에 걸쳐 누적되는 배치 상태. */
interface ToolBatchState {
    /** 채팅 서브에이전트 호출 집계 — 메시지당 캡(CHAT_SUBAGENT.MAX_CALLS) 초과 시 위임 거부. */
    delegateCalls: number;
    /** 병렬 fan-out 호출 집계 — 메시지당 캡(AGENT_SPAWN.MAX_CALLS_PER_MESSAGE) 초과 시 거부. */
    spawnCalls: number;
    /** 오케스트레이션 배정 호출 집계 — 메시지당 캡(ORCHESTRATION_DISPATCH.MAX_CALLS_PER_MESSAGE). */
    orchestrationCalls: number;
    /**
     * 오케스트레이터 산출물(이미지·영상·음성)의 미디어 마크다운 — external-provider 가 채운다.
     * 모델이 최종 응답에서 링크를 빠뜨려도 루프 종료 후 결정적으로 첨부한다.
     */
    generatedMediaMarkdowns: string[];
    /**
     * 통합(add-on)별 결정적 첨부 블록 — 도구 결과에서 떼어 최종 응답에 정확히 1회 붙인다(모델 복사에 의존하지 않음).
     * 예: 지도 통합의 지도 블록. 모델에게는 블록을 뺀 텍스트만 간다(turn-integrations.extractIntegrationBlocks).
     */
    integrationBlocks: IntegrationBlocks;
    /**
     * 오픈디자인 산출물(HTML) — create_artifact/write_file 인자에서 캡처, 마지막 저장본 유지.
     * 모델이 최종 응답에 <artifact> 를 생략하면 결정적 첨부한다(위 블록들과 동일 패턴).
     */
    odArtifact: OdArtifactCapture | null;
    /**
     * 도구(web_search)가 낸 구조화 출처 — 호출 1회당 목록 1개, 결과가 나온 순서.
     * 답변 끝 출처 목록의 번호표에 사전 주입 출처와 함께 들어간다(external-deterministic-append).
     */
    toolSources: SearchSourceRef[][];
    /**
     * 외부 내용(검색·MCP·브라우저 결과)이 대화에 들어왔는가(W3 S3) — 켜지면 승인 정책이 읽기·제어 아닌 호출도 묻는다
     * (CHAT_TOOL_APPROVAL.TAINT_ENABLED). 한 번 켜지면 요청 끝까지 유지.
     */
    tainted: boolean;
    /** 승인 대기로 흐른 시간 누적(ms, W3 S3) — 사람이 결정하는 시간이라 도구 루프 wall-clock 예산·도구 시간(toolMs)에서 뺀다. */
    approvalWaitMs: number;
    /**
     * 승인 요청이 무응답(timeout)으로 끝났는가(W3 S3) — 켜지면 같은 요청의 다음 승인 대상 호출은 기다리지 않고 시간 초과 문구로 거절한다
     * (사용자가 자리를 비웠다 — 턴마다 TIMEOUT_MS 씩 쌓이지 않게). 도구 목록은 줄이지 않는다.
     */
    approvalUnanswered: boolean;
}

/** 빈 배치 상태 — 요청 1건마다 새로 만든다. */
export function createToolBatchState(): ToolBatchState {
    return {
        delegateCalls: 0,
        spawnCalls: 0,
        orchestrationCalls: 0,
        generatedMediaMarkdowns: [],
        integrationBlocks: {},
        odArtifact: null,
        toolSources: [],
        tainted: false,
        approvalWaitMs: 0,
        approvalUnanswered: false,
    };
}

/** 승인 알림 콜백(WS 전송) 실패가 대기·실행을 깨지 않게 — onPending 은 레지스트리 Promise 안에서 돈다. */
function notifySafely(what: string, fn: () => void): void {
    try { fn(); } catch (e) {
        logger.warn(`채팅 승인 ${what} 알림 실패(무시): ${e instanceof Error ? e.message : String(e)}`);
    }
}

/**
 * 채팅 도구 승인(W3 S3) — 정책이 요구하는 호출이면 사람의 결정을 기다린다. 실행해도 되면 null, 아니면 모델에게 줄 거절 결과.
 * 대기 키는 대화 id(없으면 — REST 경로 — 사용자 id). 정책 none 에서 늘 거절되는 바닥(외부 MCP·자격증명/지시 파일 쓰기)은
 * 승인 채널·앞선 무응답과 무관하게 레지스트리가 대기 없이 policy_floor 로 거절하고 감사한다(바닥은 정책으로 내려가지 않는다 — #1469,
 * 설계 2026-10-22 §2.3). 묻는 바닥(memory_save·사이트 쓰기)은 none 에서도 종전 승인 경로를 탄다.
 * 대기 없이 끝난 거절(승인 채널 없음·앞선 무응답·policy_floor)은 알릴 대기 카드가 없어 decided 를 보내지 않는다.
 */
async function gateChatToolCall(p: {
    deps: ExternalProviderDeps;
    req: ChatMessageRequest;
    tc: ExternalToolCall;
    policy: TaskSandboxApprovalPolicy;
    taintedContext: boolean;
    /** 승인 채널이 있는가(hasChatApprovalChannel) — 없으면 기다리지 않고 바로 거절한다. */
    hasChannel: boolean;
    userId: string;
    langCode: string | undefined;
    state: ToolBatchState;
}): Promise<string | null> {
    const { deps, req, tc, policy, userId } = p;
    const args = tc.args as Record<string, unknown>;
    if (!requiresApproval(policy, tc.name, args, { taintedContext: p.taintedContext })) return null;
    const chatId = req.sessionId || userId;
    const floorDenied = floorDeniedUnderPolicy(policy, tc.name, args) !== null;
    if (!floorDenied && !p.hasChannel) {
        const r = rejectWithoutApprovalChannel({ chatId, userId, toolName: tc.name, args });
        return getChatApprovalDeniedResult(tc.name, r.reason, p.langCode);
    }
    if (!floorDenied && p.state.approvalUnanswered) {
        logger.info(`[chat:${chatId}] 앞선 승인이 무응답으로 끝나 대기 없이 거절: ${tc.name}`);
        return getChatApprovalDeniedResult(tc.name, 'timeout', p.langCode);
    }
    const shown: { approvalId?: string } = {};
    const r = await requestChatApproval({
        chatId,
        userId,
        toolName: tc.name,
        args,
        policy,
        ...(req.abortSignal ? { signal: req.abortSignal } : {}),
        onPending: (pa) => {
            shown.approvalId = pa.approvalId;
            notifySafely('대기', () => deps.chatApprovalPendingCallback?.({
                approvalId: pa.approvalId, toolName: pa.toolName, args: pa.args, riskClass: pa.riskClass,
                expiresAt: pa.createdAt + CHAT_TOOL_APPROVAL.TIMEOUT_MS,
            }));
        },
    });
    p.state.approvalWaitMs += r.waitedMs;
    if (r.reason === 'timeout') p.state.approvalUnanswered = true;
    const approvalId = shown.approvalId;
    if (approvalId) {
        notifySafely('결정', () => deps.chatApprovalDecidedCallback?.({ approvalId, decision: r.decision, ...(r.reason ? { reason: r.reason } : {}) }));
    }
    return r.decision === 'approved' ? null : getChatApprovalDeniedResult(tc.name, r.reason, p.langCode);
}

/**
 * 한 턴의 tool_calls 를 실행해 tool 메시지로 messages 에 push 한다.
 * messages·state 를 직접 변형한다(호출부와 공유).
 */
export async function runToolCallBatch(params: {
    deps: ExternalProviderDeps;
    req: ChatMessageRequest;
    ctx: StreamFromExternalContext;
    /** 이번 요청의 노출 도구 — 위임 서브에이전트에 그대로 물려준다. */
    tools: ToolDefinition[];
    messages: ChatMessage[];
    toolCalls: ExternalToolCall[];
    state: ToolBatchState;
}): Promise<void> {
    const { deps, req, ctx, tools, messages, toolCalls, state } = params;

    // 평가 dry-run(F26.2) — 호출은 관찰만 하고 실행하지 않는다. 결과 문구는 모델이 재호출 없이 마무리하도록 유도.
    if (req.evalToolObserver?.dryRun) {
        for (const tc of toolCalls) {
            messages.push({ role: 'tool', content: EVAL_DRY_RUN_TOOL_RESULT, tool_name: tc.name, tool_call_id: tc.id });
        }
        return;
    }

    // 채팅 도구 승인(W3 S3) — 정책(채팅 기본 ∨ 조직 하한)은 배치당 1회 정한다. none 에서도 게이트는 돈다 — 해 없는 호출은
    // requiresApproval 이 false 라 즉시 실행되고, 바닥 호출은 작업 경로와 같은 규칙으로 거절·승인된다(#1469).
    const userCtx = deps.currentUserContext ?? { userId: 'guest', role: 'guest' };
    const userId = String(userCtx.userId);
    const policy = await resolveChatApprovalPolicy({ userId, role: userCtx.role });
    const hasChannel = hasChatApprovalChannel({
        hasPendingCallback: !!deps.chatApprovalPendingCallback, userId, role: userCtx.role, approvalCards: req.approvalCards,
    });
    // 오염 문맥 — 읽기성 조회 예외(TAINT_EXEMPT_TOOLS)는 taint 로 묻지 않는다(자기 등급이 승인 대상이면 그대로 묻는다).
    const taintedFor = (name: string) => CHAT_TOOL_APPROVAL.TAINT_ENABLED && state.tainted && !CHAT_TOOL_APPROVAL.TAINT_EXEMPT_TOOLS.has(name);
    // 서브에이전트에는 승인 창이 없어(skipApprovalGate — 대기만 생략) 승인이 필요한 도구는 주지 않고, 실제 인자로 승인이 필요해지는
    // 호출은 서브가 같은 정책(parentPolicy)으로 거절한다 — 부모가 승인 뒤 직접 부른다(#1469).
    const subagentTools = stripApprovalGatedTools(tools, policy);
    // 위임 경계의 오염 문맥 — 서브는 지금의 taint 를 물려받고, 외부 결과를 받으면 부모에 알려 다음 부모 호출도 오염 문맥으로 판정한다
    // (spawn_agents 는 제어 등급이라 이름만으로는 외부 결과를 알 수 없다). 판정 규칙은 같은 TAINT_ENABLED·예외 도구·requiresApproval.
    const subagentTaint = () => ({ inherited: state.tainted, onExternalOutput: () => { state.tainted = true; } });

    // 읽기 전용 도구(web_search·extract_webpage …) 2건 이상이면 동시에 선실행 — 결과는 아래
    // 순차 루프가 원래 호출 순서대로 배치한다. 승인이 필요한 호출은 선실행하지 않는다(루프에서 묻는다).
    const parallelReadOnlyResults = await prefetchReadOnlyCalls(
        toolCalls,
        (tc) => !requiresApproval(policy, tc.name, tc.args as Record<string, unknown>, { taintedContext: taintedFor(tc.name) }),
        (tc) => executeExternalTool(deps, tc.name, tc.args as Record<string, unknown>, state.toolSources),
        { path: 'chat', ...(req.abortSignal ? { signal: req.abortSignal } : {}) },
    );
    for (const tc of toolCalls) {
        let toolResult: string;
        // 선실행된 호출은 이미 실행됐다(배치 시작 시점의 문맥에서 승인 불요로 판정) — 다시 묻지 않는다.
        const denied = parallelReadOnlyResults.has(tc.id) ? null : await gateChatToolCall({
            deps, req, tc, policy, taintedContext: taintedFor(tc.name), hasChannel, userId,
            langCode: ctx.resolvedLanguage || req.userLanguagePreference, state,
        });
        if (denied !== null) {
            toolResult = denied;
        } else if (tc.name === CHAT_DELEGATE_TOOL_NAME) {
            // 서브에이전트 위임 — 부모 채팅 활성 도구 서브셋으로 depth=1 tool-loop.
            deps.mcpToolStartCallback?.({ toolName: tc.name });
            state.delegateCalls++;
            toolResult = state.delegateCalls > CHAT_SUBAGENT.MAX_CALLS
                ? `Error: 이 메시지의 전문가 위임 한도(${CHAT_SUBAGENT.MAX_CALLS}회)에 도달했습니다. 지금까지의 정보로 직접 답변하세요.`
                : await runChatDelegate({
                    args: tc.args as Record<string, unknown>,
                    chatTools: subagentTools,
                    parentPolicy: policy,
                    chatTaint: subagentTaint(),
                    userCtx: deps.currentUserContext ?? { userId: 'guest', role: 'guest' },
                    ...(req.abortSignal ? { signal: req.abortSignal } : {}),
                });
        } else if (tc.name === SPAWN_AGENTS_TOOL_NAME) {
            // 병렬 서브에이전트 fan-out — 부모 채팅 활성 도구 서브셋으로 depth=1 × N.
            deps.mcpToolStartCallback?.({ toolName: tc.name });
            state.spawnCalls++;
            toolResult = state.spawnCalls > AGENT_SPAWN.MAX_CALLS_PER_MESSAGE
                ? `Error: 이 메시지의 병렬 위임 한도(${AGENT_SPAWN.MAX_CALLS_PER_MESSAGE}회)에 도달했습니다. 지금까지의 결과로 직접 답변하세요.`
                : await runChatSpawnAgents({
                    args: tc.args as Record<string, unknown>,
                    chatTools: subagentTools,
                    parentPolicy: policy,
                    chatTaint: subagentTaint(),
                    userCtx: deps.currentUserContext ?? { userId: 'guest', role: 'guest' },
                    ...(req.abortSignal ? { signal: req.abortSignal } : {}),
                });
            // 셰도우 계측(110) — 이 턴에서 처음 호출된 오케스트레이션류 도구로 기록.
            if (ctx.orchestrationTelemetry && !ctx.orchestrationTelemetry.called) {
                ctx.orchestrationTelemetry.called = tc.name;
                ctx.orchestrationTelemetry.success = !toolResult.startsWith('Error');
            }
        } else if (isOrchestrationTool(tc.name)) {
            // 오케스트레이션 자동 배정 — 토론 인라인 실행 / 백그라운드 작업 위임.
            deps.mcpToolStartCallback?.({ toolName: tc.name });
            state.orchestrationCalls++;
            toolResult = state.orchestrationCalls > ORCHESTRATION_DISPATCH.MAX_CALLS_PER_MESSAGE
                ? `Error: 이 메시지의 오케스트레이션 호출 한도(${ORCHESTRATION_DISPATCH.MAX_CALLS_PER_MESSAGE}회)에 도달했습니다. 지금까지의 결과로 직접 답변하세요.`
                : await runOrchestrationTool({
                    name: tc.name,
                    args: tc.args as Record<string, unknown>,
                    userCtx: deps.currentUserContext ?? { userId: 'guest', role: 'guest' },
                    ...(req.userLanguagePreference ? { userLanguage: req.userLanguagePreference } : {}),
                    ...(req.abortSignal ? { signal: req.abortSignal } : {}),
                    attachments: req.attachments,
                });
            // 위임한 백그라운드 작업을 ctx 에 남긴다 — REST 응답의 agent_tasks 로 나가 클라이언트가 지켜본다.
            recordDelegatedTask(ctx, tc.name, tc.args as Record<string, unknown>, toolResult);
            // Stage 2 셰도우 계측 — 첫 호출의 도구명·성공 여부 기록.
            if (ctx.orchestrationTelemetry && !ctx.orchestrationTelemetry.called) {
                ctx.orchestrationTelemetry.called = tc.name;
                ctx.orchestrationTelemetry.success = !toolResult.startsWith('Error');
            }
        } else {
            // 병렬 선실행된 읽기 전용 결과가 있으면 재실행 없이 소비.
            toolResult = parallelReadOnlyResults.get(tc.id)
                ?? await executeExternalTool(deps, tc.name, tc.args as Record<string, unknown>, state.toolSources);
        }
        if (denied === null && bringsExternalContent(tc.name, tc.args as Record<string, unknown>)) state.tainted = true;
        // 오픈디자인 HTML 산출물 캡처 — 저장 성공한 자체완결 HTML 만, 마지막 것 유지.
        // mcp_call 메타 도구 경유 간접 호출도 server::tool 로 정규화해 동일 캡처한다.
        if (OD_ARTIFACT_ECHO.ENABLED) {
            const eff = normalizeOdToolCall(tc.name, tc.args as Record<string, unknown>);
            if (OD_ARTIFACT_ECHO.TOOL_NAMES.includes(eff.name)) {
                const captured = captureOdArtifactHtml(eff.args, toolResult);
                if (captured) state.odArtifact = captured;
            }
        }
        // 통합 블록 수집 + 모델용 텍스트에서 제거 — 큰 블록 JSON 을 컨텍스트에서 보면 qwen 이 블록을 반복
        // 복사(degeneration)한다. 블록은 최종 응답에 결정적으로 정확히 1회만 첨부한다.
        const modelFacingResult = extractIntegrationBlocks(toolResult, state.integrationBlocks);
        // 도구 결과가 대상 언어와 다른 문자 체계(영문 문서·파일 조작 결과 등)면 말미에 언어 리마인더 —
        // 시스템 프롬프트 지시만으론 긴 영문 결과 뒤 답변이 영어로 드리프트(90일 실측 10.7%).
        const langCode = ctx.resolvedLanguage || req.userLanguagePreference;
        messages.push({
            role: 'tool',
            content: withLanguageNote(modelFacingResult, langCode),
            tool_name: tc.name,
            tool_call_id: tc.id,
        });
    }
}
