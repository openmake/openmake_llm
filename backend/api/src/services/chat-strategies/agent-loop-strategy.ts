/**
 * ============================================================
 * AgentLoopStrategy - Multi-turn 도구 호출 루프 전략
 * ============================================================
 *
 * LLM이 도구 호출을 요청하면 해당 도구를 실행하고 결과를 다시 LLM에 전달하는
 * 반복 루프를 수행합니다. 도구 호출이 없을 때까지 또는 최대 턴 수에 도달할 때까지 반복합니다.
 *
 * @module services/chat-strategies/agent-loop-strategy
 * @description
 * - DirectStrategy를 내부 빌딩 블록으로 사용하여 각 턴을 실행
 * - 도구 접근 권한 검사 (UserTier 기반 tool-tiers)
 * - 내장 도구 직접 처리: web_search, web_fetch, vision_ocr, analyze_image
 * - 기타 도구는 ToolRouter를 통해 MCP 도구로 실행
 * - maxTurns 제한으로 무한 루프 방지
 */
import type { ToolDefinition } from '../../ollama/types';
import { canUseTool } from '../../mcp/tool-tiers';
import { getUnifiedMCPClient } from '../../mcp/unified-client';
import { DirectStrategy } from './direct-strategy';
import type { AgentLoopStrategyContext, ChatStrategy, ChatResult } from './types';
import { createLogger } from '../../utils/logger';
import { TRUNCATION, TOOL_RESULT_COMPACTION, LOOP_DETECTION, PRE_COMPLETION_CHECKLIST, TRACE_ANALYZER, EVAL_PIPELINE, CONTEXT_GC, INFORMED_FALLBACK } from '../../config/runtime-limits';
import { TraceAnalyzer } from './trace-analyzer';
import { EvalPipeline } from './eval-pipeline';
import { ContextGC } from './context-gc';
import { semanticCompact } from '../semantic-compactor';
import { LLM_TEMPERATURES } from '../../config/llm-parameters';
import { VISION_OCR_SYSTEM_PROMPT, VISION_ANALYSIS_SYSTEM_PROMPT } from '../../prompts/vision-system';
import { getChecklistPrompt, parseChecklistResult } from '../../prompts/checklist-system';

const logger = createLogger('AgentLoopStrategy');

// ============================================
// Loop Detection 내부 타입
// ============================================

/** 도구 호출 추적 엔트리 */
interface ToolCallEntry {
    /** 도구 이름 */
    name: string;
    /** 인자 해시 (간단한 문자열 기반) */
    argsHash: string;
    /** 결과가 에러인지 여부 */
    isError: boolean;
    /** 에러 메시지 (에러인 경우) */
    errorMessage?: string;
}

/**
 * 도구 호출 인자를 간단한 해시 문자열로 변환합니다.
 * 완전한 암호학적 해시가 아닌, 동일성 비교용 경량 해시입니다.
 * 키를 알파벳 순으로 정렬하여 {a:1, b:2}와 {b:2, a:1}이 동일 해시가 되도록 합니다.
 */
function hashToolArgs(args: Record<string, unknown>): string {
    try {
        const sortedKeys = Object.keys(args).sort();
        const sorted: Record<string, unknown> = {};
        for (const key of sortedKeys) {
            sorted[key] = args[key];
        }
        const str = JSON.stringify(sorted);
        return str.substring(0, LOOP_DETECTION.ARGS_HASH_MAX_LENGTH);
    } catch {
        return 'unhashable';
    }
}

/**
 * Multi-turn 도구 호출 루프 전략
 *
 * DirectStrategy로 LLM 호출 → 도구 호출 감지 → 도구 실행 → 결과 전달의
 * 반복 루프를 관리합니다. GV(Generate-Verify) 실패 시 폴백 전략으로도 사용됩니다.
 *
 * @class AgentLoopStrategy
 * @implements {ChatStrategy<AgentLoopStrategyContext, ChatResult>}
 */
export class AgentLoopStrategy implements ChatStrategy<AgentLoopStrategyContext, ChatResult> {
    /**
     * AgentLoopStrategy 인스턴스를 생성합니다.
     *
     * @param directStrategy - 각 턴에서 LLM 호출에 사용할 DirectStrategy 인스턴스
     */
    constructor(private readonly directStrategy: DirectStrategy) {}

    /**
     * Multi-turn 도구 호출 루프를 실행합니다.
     *
     * 실행 흐름:
     * 1. DirectStrategy로 LLM 호출
     * 2. tool_calls가 있으면 → 각 도구 실행 → 결과를 히스토리에 추가 → 1로 돌아감
     * 3. tool_calls가 없으면 → 최종 응답으로 루프 종료
     * 4. maxTurns 도달 시 → 마지막 응답으로 루프 종료
     *
     * @param context - AgentLoop 컨텍스트 (클라이언트, 히스토리, 도구, 최대 턴 수 등)
     * @returns 최종 응답 텍스트와 메트릭을 포함한 결과
     */
    async execute(context: AgentLoopStrategyContext): Promise<ChatResult> {
        let metrics: Record<string, unknown> = {};
        let currentTurn = 0;
        let finalResponse = '';

        // ── P0: Loop Detection 상태 초기화 ──
        const callHistory: ToolCallEntry[] = [];
        let loopWarningInjected = false;
        let loopBroken = false;

        // ── P4: Trace Analyzer 초기화 ──
        const traceAnalyzer = TRACE_ANALYZER.ENABLED ? new TraceAnalyzer() : null;

        // ── P5: Context GC 초기화 ──
        const contextGC = CONTEXT_GC.ENABLED ? new ContextGC() : null;

        // ── P1 Routing: Informed Fallback — 이전 전략 실패 원인 주입 ──
        if (INFORMED_FALLBACK.ENABLED && context.fallbackHint) {
            const hint = context.fallbackHint;
            const hintMessage = `[System Notice] This is a fallback execution. The previous "${hint.failedStrategy}" strategy failed after ${hint.turnsConsumed} turns (${hint.elapsedMs}ms). Reason: ${hint.reason}. Please use a different approach to answer the user's question.`;
            context.currentHistory.push({ role: 'user', content: hintMessage });
            logger.info(
                `📋 Informed Fallback 주입: ${hint.failedStrategy} 실패 → 원인: ${hint.reason}`,
            );
            if (INFORMED_FALLBACK.INCLUDE_IN_METRICS) {
                metrics.fallbackHint = {
                    failedStrategy: hint.failedStrategy,
                    reason: hint.reason,
                    turnsConsumed: hint.turnsConsumed,
                    elapsedMs: hint.elapsedMs,
                };
            }
        }

        while (currentTurn < context.maxTurns) {
            context.checkAborted?.();

            currentTurn++;
            // ExecutionState 참조 업데이트 (폴백 시 소모 턴 추적)
            if (context.executionState) {
                context.executionState.turnsUsed++;
            }
            logger.info(`🔄 Agent Loop Turn ${currentTurn}/${context.maxTurns}`);

            // 모델이 도구 호출을 지원하고, single 전략이 아닌 경우에만 도구 목록 조회
            // Fast 프로파일(single)은 속도 최적화를 위해 도구 호출 비활성화
            let allowedTools: ToolDefinition[] = [];
            const execStrategy = context.executionPlan?.executionStrategy;
            if (context.supportsTools && execStrategy !== 'single') {
                allowedTools = context.getAllowedTools();
            }

            // Thinking 깊이 결정: ExecutionPlan 프로파일 > 사용자 요청 > 비활성화
            const profileThinking = context.executionPlan?.thinkingLevel;
            const effectiveThinking = profileThinking && profileThinking !== 'off'
                ? profileThinking
                : (context.thinkingMode ? (context.thinkingLevel || 'high') : undefined);
            const thinkOption = (effectiveThinking && context.supportsThinking) ? effectiveThinking : undefined;

            const directResult = await this.directStrategy.execute({
                onToken: context.onToken,
                abortSignal: context.abortSignal,
                checkAborted: context.checkAborted,
                client: context.client,
                currentHistory: context.currentHistory,
                chatOptions: context.chatOptions,
                allowedTools,
                thinkOption,
                format: context.format,
            });

            if (directResult.metrics) {
                metrics = { ...directResult.metrics };
            }

            context.currentHistory.push(directResult.assistantMessage);

            if (directResult.toolCalls.length > 0) {
                logger.info(`🛠️ Tool Calls detected: ${directResult.toolCalls.length}`);

                for (const toolCall of directResult.toolCalls) {
                    const toolName = toolCall.function?.name || 'unknown';
                    const toolArgs = toolCall.function?.arguments || {};

                    // ── P4: Trace Analyzer — 도구 호출 시작 (stateless) ──
                    let traceCtx: ReturnType<TraceAnalyzer['startToolCall']> | null = null;
                    if (traceAnalyzer) {
                        traceAnalyzer.setTurn(currentTurn);
                        traceCtx = traceAnalyzer.startToolCall(toolName, toolArgs as Record<string, unknown>);
                    }

                    const toolResult = await this.executeToolCall(context, toolCall);
                    const isError = toolResult.startsWith('Error:') || toolResult.startsWith('🔒 권한 없음');

                    // ── P4: Trace Analyzer — 도구 호출 종료 ──
                    if (traceAnalyzer && traceCtx) {
                        traceAnalyzer.endToolCall(
                            traceCtx, toolResult, isError,
                            isError ? toolResult.substring(0, 200) : undefined,
                        );
                    }

                    // ── P0: Loop Detection — 호출 추적 ──
                    const entry: ToolCallEntry = {
                        name: toolName,
                        argsHash: hashToolArgs(toolArgs),
                        isError,
                        errorMessage: isError ? toolResult.substring(0, 200) : undefined,
                    };
                    callHistory.push(entry);
                    // 윈도우 크기 유지
                    if (callHistory.length > LOOP_DETECTION.TRACKING_WINDOW) {
                        callHistory.shift();
                    }

                    // Ollama 공식 스펙: tool 결과 메시지에 tool_name 필수
                    context.currentHistory.push({
                        role: 'tool',
                        content: toolResult,
                        tool_name: toolCall.function?.name,
                    });
                }

                // ── P0: Loop Detection — 패턴 감지 ──
                const loopStatus = this.detectLoop(callHistory);

                if (loopStatus === 'break') {
                    loopBroken = true;
                    logger.warn('🚨 Doom Loop 강제 종료: 동일 패턴 반복 임계값 초과');
                    // 루프 탈출 시 LLM에게 요약 응답 요청
                    // user role 사용: 일부 모델은 대화 중간 system role을 거부함
                    context.currentHistory.push({
                        role: 'user',
                        content: '[System Notice] The same tool call has been repeated and the loop has been forcefully terminated. Based on results so far, provide the best possible answer to the user. Explain what approach failed and suggest alternatives.',
                    });
                    // 마지막 1턴으로 요약 응답 생성
                    const summaryResult = await this.directStrategy.execute({
                        onToken: context.onToken,
                        abortSignal: context.abortSignal,
                        checkAborted: context.checkAborted,
                        client: context.client,
                        currentHistory: context.currentHistory,
                        chatOptions: context.chatOptions,
                        allowedTools: [], // 도구 없이 텍스트만 생성
                        thinkOption,
                        format: context.format,
                    });
                    finalResponse = summaryResult.response;
                    break;
                }

                if (loopStatus === 'warn' && !loopWarningInjected) {
                    loopWarningInjected = true;
                    logger.warn('⚠️ Doom Loop 경고: 동일 패턴 반복 감지, 접근법 변경 유도');
                    // user role 사용: 일부 모델은 대화 중간 system role을 거부함
                    context.currentHistory.push({
                        role: 'user',
                        content: '[System Notice] You are repeating the same tool call with the same arguments. The previous approach is failing. Try a different tool, different arguments, or ask the user for more information.',
                    });
                }

                // 도구 결과 컴팩션: 오래된 도구 결과를 요약하여 컨텍스트 낭비 방지
                // Anthropic 하네스 원칙: "오래된 도구 결과는 요약/정리"
                await this.compactOldToolResults(context.currentHistory);

                // ── P5: Context GC — 적응형 컨텍스트 가비지 컬렉션 ──
                if (contextGC) {
                    try {
                        const gcResult = contextGC.run(context.currentHistory);
                        if (gcResult.pressureLevel !== 'normal') {
                            logger.info(
                                `🗑️ Context GC 실행 (turn ${currentTurn}): ` +
                                `${gcResult.pressureLevel}, ${gcResult.charsBefore}→${gcResult.charsAfter}자`,
                            );
                        }
                    } catch (gcError) {
                        logger.warn('⚠️ Context GC 실행 중 오류 (무시):', gcError instanceof Error ? gcError.message : gcError);
                    }
                }
            } else {
                finalResponse = directResult.response;
                break;
            }
        }

        // ── P2: PreCompletion Checklist — 종료 전 셀프 검증 ──
        if (!loopBroken) {
            finalResponse = await this.runPreCompletionChecklist(
                context, finalResponse, metrics,
            );
        }

        // Loop Detection 메트릭 기록
        metrics.loopDetection = {
            totalToolCalls: callHistory.length,
            warningInjected: loopWarningInjected,
            loopBroken,
        };

        // ── P4: Trace Analyzer — 분석 결과 기록 ──
        if (traceAnalyzer && TRACE_ANALYZER.INCLUDE_IN_METRICS) {
            metrics.traceAnalysis = traceAnalyzer.analyze();
        }

        // ── P5: Context GC — 누적 통계 기록 ──
        if (contextGC && CONTEXT_GC.INCLUDE_IN_METRICS) {
            metrics.contextGC = contextGC.getStats();
        }

        // ── P3: Eval Pipeline — 응답 품질 평가 ──
        if (EVAL_PIPELINE.ENABLED && EVAL_PIPELINE.INCLUDE_IN_METRICS
            && finalResponse.length >= EVAL_PIPELINE.MIN_RESPONSE_LENGTH) {
            const userMsg = context.currentHistory.find(m => m.role === 'user');
            const query = typeof userMsg?.content === 'string' ? userMsg.content : '';
            metrics.evalResult = EvalPipeline.evaluate({ query, response: finalResponse });
        }

        return {
            response: finalResponse,
            metrics,
        };
    }

    /**
     * Doom Loop 패턴을 감지합니다.
     *
     * 최근 호출 이력에서 동일 도구+인자 반복 또는 동일 에러 반복을 탐지합니다.
     *
     * @returns 'ok' = 정상, 'warn' = 경고 주입 필요, 'break' = 루프 강제 종료
     */
    private detectLoop(callHistory: ToolCallEntry[]): 'ok' | 'warn' | 'break' {
        if (callHistory.length < LOOP_DETECTION.SAME_CALL_WARN_AT) return 'ok';

        // 동일 도구+인자 반복 카운트 (연속)
        const latest = callHistory[callHistory.length - 1];
        let sameCallCount = 0;
        let sameErrorCount = 0;

        for (let i = callHistory.length - 1; i >= 0; i--) {
            const entry = callHistory[i];
            if (entry.name === latest.name && entry.argsHash === latest.argsHash) {
                sameCallCount++;
            } else {
                break; // 연속이 끊기면 중단
            }
        }

        // 동일 에러 반복 카운트 (비연속 포함)
        if (latest.isError && latest.errorMessage) {
            for (const entry of callHistory) {
                if (entry.isError && entry.errorMessage === latest.errorMessage) {
                    sameErrorCount++;
                }
            }
        }

        // 강제 종료 판정
        if (sameCallCount >= LOOP_DETECTION.SAME_CALL_BREAK_AT ||
            sameErrorCount >= LOOP_DETECTION.SAME_ERROR_BREAK_AT) {
            return 'break';
        }

        // 경고 판정
        if (sameCallCount >= LOOP_DETECTION.SAME_CALL_WARN_AT ||
            sameErrorCount >= LOOP_DETECTION.SAME_ERROR_WARN_AT) {
            return 'warn';
        }

        return 'ok';
    }

    /**
     * PreCompletion Checklist: AgentLoop 종료 직전 셀프 검증을 수행합니다.
     *
     * Harness Engineering 원칙 (Verify):
     * 에이전트가 응답 완료 전에 스스로 체크리스트를 점검하여
     * 1차 해결률(First-pass Resolution)을 극대화합니다.
     *
     * @param context - AgentLoop 컨텍스트
     * @param response - 최종 응답 텍스트
     * @param metrics - 응답 메트릭 (체크리스트 결과 기록용)
     * @returns 검증 후 최종 응답 (수정되었을 수 있음)
     */
    private async runPreCompletionChecklist(
        context: AgentLoopStrategyContext,
        response: string,
        metrics: Record<string, unknown>,
    ): Promise<string> {
        // 비활성화, 짧은 응답, 빈 응답이면 스킵
        if (!PRE_COMPLETION_CHECKLIST.ENABLED ||
            response.length < PRE_COMPLETION_CHECKLIST.MIN_RESPONSE_LENGTH) {
            return response;
        }

        try {
            // 쿼리 타입 추론: 히스토리에서 코드 관련 패턴 감지
            const userMessage = [...context.currentHistory].reverse()
                .find(m => m.role === 'user')?.content || '';
            const isCodeRelated = PRE_COMPLETION_CHECKLIST.CODE_DOMAIN_PATTERN.test(
                response + userMessage
            );
            const domain = isCodeRelated ? 'code' : 'general';

            const checklistPrompt = getChecklistPrompt(domain, response);

            // 체크리스트 검증 턴 (도구 없이 텍스트만)
            const checkResult = await this.directStrategy.execute({
                onToken: () => {}, // 체크리스트 결과는 사용자에게 스트리밍하지 않음
                abortSignal: context.abortSignal,
                checkAborted: context.checkAborted,
                client: context.client,
                currentHistory: [
                    ...context.currentHistory,
                    { role: 'user', content: checklistPrompt },
                ],
                chatOptions: {
                    ...context.chatOptions,
                    num_predict: PRE_COMPLETION_CHECKLIST.MAX_TOKENS,
                },
                allowedTools: [],
                format: context.format,
            });

            const parsed = parseChecklistResult(checkResult.response);
            metrics.preCompletionChecklist = {
                domain,
                passed: parsed.passed,
                issues: parsed.issues,
            };

            if (parsed.passed) {
                logger.info('✅ PreCompletion Checklist 통과');
                return response;
            }

            // 체크리스트 실패: 보충 수정 턴 실행 (최대 MAX_RETRY회)
            // 원본 응답은 이미 스트리밍됨 → 구분 헤더 후 수정 내용만 추가 스트리밍
            logger.info(`⚠️ PreCompletion Checklist 실패 (이슈: ${parsed.issues.length}개), 보충 수정 시도`);

            const issueList = parsed.issues.map((issue: string, i: number) => `${i + 1}. ${issue}`).join('\n');
            const fixPrompt = `Your previous response had these issues:\n${issueList}\n\nProvide ONLY the corrections for these issues. Do not repeat the full response.`;

            context.currentHistory.push({ role: 'user', content: fixPrompt });

            // 구분 헤더를 스트리밍으로 전송
            const separator = '\n\n---\n> 📋 *자체 검증에서 보완 사항이 발견되어 추가합니다:*\n\n';
            for (const char of separator) {
                context.onToken(char);
            }

            let fixedResponse = '';
            const fixResult = await this.directStrategy.execute({
                onToken: (token) => {
                    fixedResponse += token;
                    context.onToken(token);
                },
                abortSignal: context.abortSignal,
                checkAborted: context.checkAborted,
                client: context.client,
                currentHistory: context.currentHistory,
                chatOptions: context.chatOptions,
                allowedTools: [],
                format: context.format,
            });

            if (fixResult.response) {
                logger.info('✅ PreCompletion Checklist 보충 수정 완료');
                // 원본 + 구분자 + 보충 내용을 합쳐 최종 응답
                return response + separator + fixResult.response;
            }

            return response;
        } catch (e) {
            // 체크리스트 실패는 원본 응답으로 graceful degradation
            if (e instanceof Error && e.message === 'ABORTED') throw e;
            logger.warn('⚠️ PreCompletion Checklist 실패 (무시):', e instanceof Error ? e.message : e);
            return response;
        }
    }

    /**
     * 단일 도구 호출을 실행합니다.
     *
     * 실행 순서:
     * 1. 도구 호출 유효성 검사
     * 2. 사용자 티어 기반 접근 권한 검사
     * 3. 내장 도구 직접 처리 (web_search, web_fetch, vision_ocr, analyze_image)
     * 4. 기타 도구는 ToolRouter를 통해 MCP 도구로 실행
     *
     * @param context - AgentLoop 컨텍스트 (사용자 컨텍스트, 클라이언트 등)
     * @param toolCall - LLM이 요청한 도구 호출 정보
     * @param toolCall.type - 도구 호출 유형
     * @param toolCall.function.name - 호출할 도구 이름
     * @param toolCall.function.arguments - 도구 인자
     * @returns 도구 실행 결과 문자열 (에러 시 Error: 접두사)
     */
    private async executeToolCall(context: AgentLoopStrategyContext, toolCall: {
        type?: string;
        function: {
            name: string;
            arguments: Record<string, unknown>;
        };
    }): Promise<string> {
        if (!toolCall.function || !toolCall.function.name) return 'Error: Invalid tool call';

        const toolName = toolCall.function.name;
        const toolArgs = toolCall.function.arguments;

        // 사용자 티어 기반 도구 접근 권한 검사
        if (context.currentUserContext) {
            const userTier = context.currentUserContext.tier;
            if (!canUseTool(userTier, toolName)) {
                const tierLabel = {
                    free: '무료',
                    pro: '프로',
                    enterprise: '엔터프라이즈',
                }[userTier];

                logger.warn(`⚠️ 도구 접근 거부: ${toolName} (tier: ${userTier})`);
                return `🔒 권한 없음: ${tierLabel} 등급에서는 "${toolName}" 도구를 사용할 수 없습니다. 업그레이드가 필요합니다.`;
            }
        }

        logger.info(`🔨 Executing Tool: ${toolName} (tier: ${context.currentUserContext?.tier || 'unknown'})`, toolArgs);

        // 내장 도구 직접 처리: web_search
        if (toolName === 'web_search') {
            try {
                const query = typeof toolArgs.query === 'string' ? toolArgs.query : '';
                const maxResults = typeof toolArgs.max_results === 'number' ? toolArgs.max_results : 5;
                const response = await context.client.webSearch(query, maxResults);

                if (response.results && response.results.length > 0) {
                    const formatted = response.results.map((r, i) =>
                        `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.content?.substring(0, TRUNCATION.WEB_SNIPPET_MAX) || ''}...`
                    ).join('\n\n');
                    return `🔍 웹 검색 결과 (${response.results.length}개):\n\n${formatted}`;
                }
                return '검색 결과가 없습니다.';
            } catch (e: unknown) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                logger.error('web_search 실행 실패:', errorMessage);
                return `Error: ${errorMessage}`;
            }
        }

        // 내장 도구 직접 처리: web_fetch
        if (toolName === 'web_fetch') {
            try {
                const url = toolArgs.url as string;
                const response = await context.client.webFetch(url);

                if (response.content) {
                    return `📥 웹페이지: ${response.title}\n\n${response.content.substring(0, TRUNCATION.WEB_CONTENT_MAX)}`;
                }
                return '페이지 콘텐츠를 가져올 수 없습니다.';
            } catch (e: unknown) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                logger.error('web_fetch 실행 실패:', errorMessage);
                return `Error: ${errorMessage}`;
            }
        }

        // 내장 도구 직접 처리: vision_ocr (이미지 텍스트 추출)
        if (toolName === 'vision_ocr') {
            try {
                const imagePath = toolArgs.image_path as string;
                const imageBase64 = toolArgs.image_base64 as string;
                const language = (toolArgs.language as string) || 'auto';

                let imageData: string;
                if (imageBase64) {
                    imageData = imageBase64;
                } else if (imagePath) {
                    const { UserSandbox } = await import('../../mcp/user-sandbox');
                    const userId = context.currentUserContext?.userId || 'guest';
                    const safePath = UserSandbox.resolvePath(userId, imagePath);
                    if (!safePath) {
                        return 'Error: 접근 권한이 없는 경로입니다. 사용자 작업 디렉토리 내 파일만 접근할 수 있습니다.';
                    }
                    const { readFile } = await import('fs/promises');
                    const fileBuffer = await readFile(safePath);
                    imageData = fileBuffer.toString('base64');
                } else {
                    return 'Error: image_path 또는 image_base64가 필요합니다.';
                }

                logger.info('🔍 Vision OCR 실행 중...');

                const ocrResponse = await context.client.chat(
                    [
                        { role: 'system', content: VISION_OCR_SYSTEM_PROMPT },
                        {
                            role: 'user',
                            content: `이 이미지에서 모든 텍스트를 정확하게 추출해주세요. 원본 형식을 최대한 유지하세요.${language !== 'auto' ? ` 언어: ${language}` : ''}`,
                            images: [imageData],
                        },
                    ],
                    { temperature: LLM_TEMPERATURES.AGENT_TOOL_CALL }
                );

                const extractedText = ocrResponse.content || '';
                logger.info(`✅ OCR 완료: ${extractedText.length}자 추출`);

                return `📝 OCR 결과:\n\n${extractedText}`;
            } catch (e: unknown) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                logger.error('vision_ocr 실행 실패:', errorMessage);
                return `Error: ${errorMessage}`;
            }
        }

        // 내장 도구 직접 처리: analyze_image (이미지 분석)
        if (toolName === 'analyze_image') {
            try {
                const imagePath = toolArgs.image_path as string;
                const imageBase64 = toolArgs.image_base64 as string;
                const question = (toolArgs.question as string) || '이 이미지에 무엇이 있나요? 상세히 설명해주세요.';

                let imageData: string;
                if (imageBase64) {
                    imageData = imageBase64;
                } else if (imagePath) {
                    const { UserSandbox } = await import('../../mcp/user-sandbox');
                    const userId = context.currentUserContext?.userId || 'guest';
                    const safePath = UserSandbox.resolvePath(userId, imagePath);
                    if (!safePath) {
                        return 'Error: 접근 권한이 없는 경로입니다. 사용자 작업 디렉토리 내 파일만 접근할 수 있습니다.';
                    }
                    const { readFile } = await import('fs/promises');
                    const fileBuffer = await readFile(safePath);
                    imageData = fileBuffer.toString('base64');
                } else {
                    return 'Error: image_path 또는 image_base64가 필요합니다.';
                }

                logger.info('🖼️ 이미지 분석 실행 중...');

                const analysisResponse = await context.client.chat(
                    [
                        { role: 'system', content: VISION_ANALYSIS_SYSTEM_PROMPT },
                        {
                            role: 'user',
                            content: question,
                            images: [imageData],
                        },
                    ],
                    { temperature: LLM_TEMPERATURES.AGENT_RESPONSE }
                );

                const analysis = analysisResponse.content || '';
                logger.info('✅ 이미지 분석 완료');

                return `🖼️ 이미지 분석 결과:\n\n${analysis}`;
            } catch (e: unknown) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                logger.error('analyze_image 실행 실패:', errorMessage);
                return `Error: ${errorMessage}`;
            }
        }

        // 기타 도구: ToolRouter를 통해 MCP 도구로 실행
        try {
            const toolRouter = getUnifiedMCPClient().getToolRouter();
            const result = await toolRouter.executeTool(toolName, toolArgs, context.currentUserContext ?? undefined);
            if (result.isError) {
                return `Error executing tool: ${result.content.map((c: { text?: string }) => c.text).join('\n')}`;
            }
            return result.content.map((c: { text?: string }) => c.text).join('\n');
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            logger.error(`Tool execution failed: ${errorMessage}`);
            return `Error: ${errorMessage}`;
        }
    }

    /**
     * 오래된 도구 결과를 컴팩션하여 컨텍스트 윈도우 효율을 높입니다.
     *
     * 최근 N개(KEEP_RECENT)의 도구 결과는 원문을 유지하고,
     * 그 이전의 도구 결과는 도구명과 결과 요약(앞 200자)만 남깁니다.
     * 이는 Anthropic의 "도구 결과 정리" 권장 패턴을 따릅니다.
     */
    private async compactOldToolResults(history: Array<{ role: string; content?: string; tool_name?: string }>): Promise<void> {
        // 도구 결과 메시지의 인덱스를 역순으로 수집
        const toolIndices: number[] = [];
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].role === 'tool') {
                toolIndices.push(i);
            }
        }

        // 최근 N개는 유지, 나머지를 컴팩션
        const toCompact = toolIndices.slice(TOOL_RESULT_COMPACTION.KEEP_RECENT);
        if (toCompact.length === 0) return;

        let compactedCount = 0;
        for (const idx of toCompact) {
            const msg = history[idx];
            const content = msg.content || '';
            if (content.length > TOOL_RESULT_COMPACTION.COMPACTED_MAX_CHARS) {
                const toolName = msg.tool_name || 'unknown';

                if (TOOL_RESULT_COMPACTION.USE_SEMANTIC && content.length >= TOOL_RESULT_COMPACTION.SEMANTIC_THRESHOLD_CHARS) {
                    // Semantic Compaction: 소형 모델로 의미 보존 요약
                    msg.content = await semanticCompact(toolName, content);
                } else {
                    // 단순 절단 (기본)
                    msg.content = `[Compacted] ${toolName}: ${content.substring(0, TOOL_RESULT_COMPACTION.COMPACTED_MAX_CHARS)}...`;
                }
                compactedCount++;
            }
        }

        if (compactedCount > 0) {
            logger.info(`📦 도구 결과 컴팩션: ${compactedCount}개 결과 압축`);
        }
    }
}
