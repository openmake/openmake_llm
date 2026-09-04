/**
 * External Provider 도구 호출 배치 실행.
 *
 * 한 턴의 tool_calls 를 실행해 tool 메시지로 messages 에 싣는다 — 이미지 생성 병렬
 * 선실행, 위임(chat_delegate/spawn_agents)·오케스트레이션 분기와 호출 캡, 그리고 최종
 * 응답에 결정적으로 첨부할 블록(생성 이미지·카카오 지도·토론 출처·OD 산출물) 수집까지.
 *
 * external-provider 본체(600줄 CI 가드)에서 분리. 배치가 누적하는 값은 호출부 클로저
 * 대신 ToolBatchState 한 객체로 주고받는다.
 *
 * @module services/chat-service/external-tool-batch
 */
import { createLogger } from '../../utils/logger';
import { CHAT_SUBAGENT, AGENT_SPAWN, ORCHESTRATION_DISPATCH, OD_ARTIFACT_ECHO, IMAGE_GEN_PARALLEL } from '../../config/runtime-limits';
import { CHAT_DELEGATE_TOOL_NAME, runChatDelegate } from './chat-delegate';
import { SPAWN_AGENTS_TOOL_NAME, runChatSpawnAgents } from '../agent-spawn/spawn-agents';
import { isOrchestrationTool, runOrchestrationTool } from './orchestration-dispatch';
import { executeExternalTool } from './external-tool-exec';
import { captureOdArtifactHtml, normalizeOdToolCall, type OdArtifactCapture } from './external-deterministic-append';
import { extractDiscussionSources } from '../../agents/discussion-sources';
import { parallelBatch } from '../../workflow/graph-engine';
import { prefetchReadOnlyCalls } from '../tool-parallel';
import type { ChatMessage, ToolDefinition } from '../../llm';
import type { ChatMessageRequest } from '../chat-service-types';
import type { ChatStreamResult } from '../../providers/i-provider';
import type { ExternalProviderDeps, StreamFromExternalContext } from './external-provider-types';
import { withLanguageNote } from './tool-result-language';

const logger = createLogger('ChatExternalProvider');

type ExternalToolCall = NonNullable<ChatStreamResult['toolCalls']>[number];

/** 도구 루프 전체에 걸쳐 누적되는 배치 상태. */
export interface ToolBatchState {
    /** 이미지 생성 소요시간 누적 — wall-clock 예산 공제용 (상한 WALL_CLOCK_CREDIT_MAX_MS). */
    imageGenCreditMs: number;
    /** 채팅 서브에이전트 호출 집계 — 메시지당 캡(CHAT_SUBAGENT.MAX_CALLS) 초과 시 위임 거부. */
    delegateCalls: number;
    /** 병렬 fan-out 호출 집계 — 메시지당 캡(AGENT_SPAWN.MAX_CALLS_PER_MESSAGE) 초과 시 거부. */
    spawnCalls: number;
    /** 오케스트레이션 배정 호출 집계 — 메시지당 캡(ORCHESTRATION_DISPATCH.MAX_CALLS_PER_MESSAGE). */
    orchestrationCalls: number;
    /**
     * generate_image 결과의 이미지 마크다운 — 일부 모델(qwen 등)이 도구 지시("마크다운 그대로
     * 포함")를 누락해 생성된 이미지가 채팅에 표시되지 않는 문제 보정용. 루프 종료 후 최종
     * 응답에 누락돼 있으면 결정적으로 첨부한다.
     */
    generatedImageMarkdowns: string[];
    /**
     * 카카오 지도: search-places 도구 결과가 동봉하는 ```kakaomap 블록. 로컬 모델(qwen)이
     * 블록을 답변에 옮기지 않고 요약해버려 지도가 안 뜨는 문제를 결정적 첨부로 보정한다.
     */
    kakaomapBlocks: string[];
    /**
     * 도구 경유 토론(start_discussion)의 출처 목록 — 모델이 도구 결과를 요약하며 버리므로
     * 마커로 실려 온 블록을 모아 최종 응답에 결정적으로 첨부한다(카카오 지도와 동일 패턴).
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
        imageGenCreditMs: 0,
        delegateCalls: 0,
        spawnCalls: 0,
        orchestrationCalls: 0,
        generatedImageMarkdowns: [],
        kakaomapBlocks: [],
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

    // 이미지 생성 병렬화 — 같은 턴의 generate_image 다중 호출(발표자료 삽화 등)은
    // FLUX 디퓨전(수십 초/장)이 지배하므로 동시 실행해 배치 시간을 1장 수준으로
    // 줄인다. executeExternalTool 은 콜백·에러를 자체 처리(실패는 'Error:' 문자열)
    // 하므로 동시 실행에 안전하고, 결과는 아래 순차 루프가 원래 호출 순서대로
    // tool 메시지에 배치한다.
    const parallelImageResults = new Map<string, string>();
    const imageCalls = toolCalls.filter((tc) => tc.name === 'generate_image');
    if (IMAGE_GEN_PARALLEL.ENABLED && imageCalls.length >= 2) {
        logger.info(`🎨 generate_image ${imageCalls.length}건 병렬 실행 (동시 상한 ${IMAGE_GEN_PARALLEL.MAX_CONCURRENT})`);
        const imageBatchStartedAt = Date.now();
        await parallelBatch(
            imageCalls,
            async (tc) => {
                parallelImageResults.set(
                    tc.id,
                    await executeExternalTool(deps, tc.name, tc.args as Record<string, unknown>),
                );
            },
            { concurrency: IMAGE_GEN_PARALLEL.MAX_CONCURRENT },
        );
        state.imageGenCreditMs = Math.min(
            state.imageGenCreditMs + (Date.now() - imageBatchStartedAt),
            IMAGE_GEN_PARALLEL.WALL_CLOCK_CREDIT_MAX_MS,
        );
    }
    // 읽기 전용 도구(web_search·extract_webpage …) 2건 이상이면 동시에 선실행 — 결과는 아래
    // 순차 루프가 원래 호출 순서대로 배치한다(이미지 병렬과 같은 계약). 채팅은 승인 게이트가 없다.
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
            // 병렬 선실행된 이미지 결과가 있으면 재실행 없이 소비.
            // 단건 이미지 생성도 소요시간을 공제 누적한다 (배치와 동일 근거).
            const singleImageStartedAt = tc.name === 'generate_image' && !parallelImageResults.has(tc.id)
                ? Date.now() : 0;
            toolResult = parallelImageResults.get(tc.id)
                ?? parallelReadOnlyResults.get(tc.id)
                ?? await executeExternalTool(deps, tc.name, tc.args as Record<string, unknown>);
            if (singleImageStartedAt > 0) {
                state.imageGenCreditMs = Math.min(
                    state.imageGenCreditMs + (Date.now() - singleImageStartedAt),
                    IMAGE_GEN_PARALLEL.WALL_CLOCK_CREDIT_MAX_MS,
                );
            }
        }
        if (tc.name === 'generate_image') {
            const m = toolResult.match(/!\[[^\]]*\]\(\/generated\/[^)]+\)/);
            if (m && !state.generatedImageMarkdowns.includes(m[0])) {
                state.generatedImageMarkdowns.push(m[0]);
            }
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
        // 카카오 지도 블록 수집(도구명 무관 — 도구 결과에 블록이 있으면).
        for (const mm of toolResult.matchAll(/```kakaomap\s*\n[\s\S]*?```/g)) {
            if (!state.kakaomapBlocks.includes(mm[0])) state.kakaomapBlocks.push(mm[0]);
        }
        // 토론 출처 블록 추출 — 모델에게 보낼 텍스트에서는 걷어낸다(요약 대상에서 제외).
        const extracted = extractDiscussionSources(toolResult);
        for (const b of extracted.blocks) {
            if (!state.discussionSourceBlocks.includes(b)) state.discussionSourceBlocks.push(b);
        }
        toolResult = extracted.modelFacing;
        // 모델에게는 블록을 제거한 텍스트만 전달한다 — 큰 경로 JSON 을 컨텍스트에서 보면
        // qwen 이 블록을 반복 복사(degeneration, 지도 수십개)하는 문제 차단. 지도는 아래
        // 결정적 주입으로 정확히 1회만 추가한다(모델 복사에 의존하지 않음).
        const modelFacingResult = toolResult
            .replace(/\[지도 표시용[^\]]*\]\s*/g, '')
            .replace(/```kakaomap\s*\n[\s\S]*?```/g, '');
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
