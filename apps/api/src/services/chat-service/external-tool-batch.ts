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
import { captureOdArtifactHtml, normalizeOdToolCall, type OdArtifactCapture } from './external-deterministic-append';
import { extractDiscussionSources } from '../../addons/discussion/sources';
import { prefetchReadOnlyCalls } from '../tool-parallel';
import type { ChatMessage, ToolDefinition } from '../../llm';
import type { ChatMessageRequest } from '../chat-service-types';
import type { ChatStreamResult } from '../../providers/i-provider';
import type { ExternalProviderDeps, StreamFromExternalContext } from './external-provider-types';
import { withLanguageNote } from './tool-result-language';

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
     * 도구 경유 토론(start_discussion)의 출처 목록 — 모델이 도구 결과를 요약하며 버리므로
     * 마커로 실려 온 블록을 모아 최종 응답에 결정적으로 첨부한다(통합 블록과 동일 패턴).
     */
    discussionSourceBlocks: string[];
    /**
     * 오픈디자인 산출물(HTML) — create_artifact/write_file 인자에서 캡처, 마지막 저장본 유지.
     * 모델이 최종 응답에 <artifact> 를 생략하면 결정적 첨부한다(위 블록들과 동일 패턴).
     */
    odArtifact: OdArtifactCapture | null;
}

/** 빈 배치 상태 — 요청 1건마다 새로 만든다. */
export function createToolBatchState(): ToolBatchState {
    return {
        delegateCalls: 0,
        spawnCalls: 0,
        orchestrationCalls: 0,
        generatedMediaMarkdowns: [],
        integrationBlocks: {},
        discussionSourceBlocks: [],
        odArtifact: null,
    };
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

    // 읽기 전용 도구(web_search·extract_webpage …) 2건 이상이면 동시에 선실행 — 결과는 아래
    // 순차 루프가 원래 호출 순서대로 배치한다. 채팅은 승인 게이트가 없다.
    const parallelReadOnlyResults = await prefetchReadOnlyCalls(
        toolCalls,
        () => true,
        (tc) => executeExternalTool(deps, tc.name, tc.args as Record<string, unknown>),
        { path: 'chat', ...(req.abortSignal ? { signal: req.abortSignal } : {}) },
    );
    for (const tc of toolCalls) {
        let toolResult: string;
        if (tc.name === CHAT_DELEGATE_TOOL_NAME) {
            // 서브에이전트 위임 — 부모 채팅 활성 도구 서브셋으로 depth=1 tool-loop.
            deps.mcpToolStartCallback?.({ toolName: tc.name });
            state.delegateCalls++;
            toolResult = state.delegateCalls > CHAT_SUBAGENT.MAX_CALLS
                ? `Error: 이 메시지의 전문가 위임 한도(${CHAT_SUBAGENT.MAX_CALLS}회)에 도달했습니다. 지금까지의 정보로 직접 답변하세요.`
                : await runChatDelegate({
                    args: tc.args as Record<string, unknown>,
                    chatTools: tools,
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
                    chatTools: tools,
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
                });
            // Stage 2 셰도우 계측 — 첫 호출의 도구명·성공 여부 기록.
            if (ctx.orchestrationTelemetry && !ctx.orchestrationTelemetry.called) {
                ctx.orchestrationTelemetry.called = tc.name;
                ctx.orchestrationTelemetry.success = !toolResult.startsWith('Error');
            }
        } else {
            // 병렬 선실행된 읽기 전용 결과가 있으면 재실행 없이 소비.
            toolResult = parallelReadOnlyResults.get(tc.id)
                ?? await executeExternalTool(deps, tc.name, tc.args as Record<string, unknown>);
        }
        // 오픈디자인 HTML 산출물 캡처 — 저장 성공한 자체완결 HTML 만, 마지막 것 유지.
        // mcp_call 메타 도구 경유 간접 호출도 server::tool 로 정규화해 동일 캡처한다.
        if (OD_ARTIFACT_ECHO.ENABLED) {
            const eff = normalizeOdToolCall(tc.name, tc.args as Record<string, unknown>);
            if (OD_ARTIFACT_ECHO.TOOL_NAMES.includes(eff.name)) {
                const captured = captureOdArtifactHtml(eff.args, toolResult);
                if (captured) state.odArtifact = captured;
            }
        }
        // 토론 출처 블록 추출 — 모델에게 보낼 텍스트에서는 걷어낸다(요약 대상에서 제외).
        const extracted = extractDiscussionSources(toolResult);
        for (const b of extracted.blocks) {
            if (!state.discussionSourceBlocks.includes(b)) state.discussionSourceBlocks.push(b);
        }
        toolResult = extracted.modelFacing;
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
