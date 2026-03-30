/**
 * ============================================================
 * ThinkingStrategy - Sprint Contract 기반 단계별 사고 전략
 * ============================================================
 *
 * Anthropic 하네스 설계 원칙:
 * - Sprint Contract: 코드 레벨의 단계 수/토큰 예산 제어
 * - Load-bearing Verification: 결론-과정 일관성 검증 (opt-in)
 * - Graceful Degradation: 예산 초과 시 결론 강제, 실패 시 AgentLoop 폴백
 *
 * 기존 AgentLoopStrategy를 래핑하여 도구 호출 기능을 유지하면서
 * 사고 단계 추적과 토큰 예산 관리를 추가합니다.
 *
 * @module services/chat-strategies/thinking-strategy
 */
import type { ChatStrategy, ChatResult, AgentLoopStrategyContext } from './types';
import type { AgentLoopStrategy } from './agent-loop-strategy';
import { createLogger } from '../../utils/logger';
import { THINKING_LIMITS, CAPACITY, REASONING_SANDWICH } from '../../config/runtime-limits';
import { OllamaClient } from '../../ollama/client';

const logger = createLogger('ThinkingStrategy');

/**
 * ThinkingStrategy 컨텍스트
 *
 * AgentLoopStrategyContext를 확장하여 Thinking 전용 메타데이터를 포함합니다.
 */
export interface ThinkingStrategyContext extends AgentLoopStrategyContext {
    /** 사용자 언어 (결론 강제 프롬프트 다국어화) */
    userLanguage?: string;
}

/**
 * ThinkingStrategy 결과
 */
/** Reasoning Sandwich 페이즈 타입 */
export type SandwichPhase = 'plan' | 'exec' | 'verify';

export interface ThinkingStrategyResult extends ChatResult {
    /** 실제 수행된 사고 단계 수 */
    thinkingSteps: number;
    /** 사고에 사용된 총 문자 수 */
    thinkingCharsUsed: number;
    /** 예산 초과로 결론이 강제되었는지 여부 */
    conclusionForced: boolean;
    /** 결론-과정 일관성 검증 통과 여부 (VERIFY_CONCLUSION=true 시에만) */
    verificationPassed?: boolean;
    /** Reasoning Sandwich 적용 여부 및 페이즈 전환 이력 */
    sandwichApplied?: boolean;
    sandwichTransitions?: Array<{ step: number; phase: SandwichPhase; level: string }>;
}

/**
 * Sprint Contract 기반 단계별 사고 전략
 *
 * AgentLoopStrategy를 래핑하여:
 * 1. 시스템 프롬프트에 단계별 사고 지시를 주입
 * 2. 응답 스트리밍 중 단계 수와 토큰 사용량을 추적
 * 3. 예산 초과 시 결론 강제 힌트를 다음 턴에 주입
 * 4. (opt-in) 최종 결론과 사고 과정의 일관성 검증
 */
export class ThinkingStrategy implements ChatStrategy<ThinkingStrategyContext, ThinkingStrategyResult> {
    constructor(private readonly agentLoopStrategy: AgentLoopStrategy) {}

    async execute(context: ThinkingStrategyContext): Promise<ThinkingStrategyResult> {
        const startTime = Date.now();
        let thinkingCharsUsed = 0;
        let thinkingSteps = 0;
        let conclusionForced = false;

        // ── Reasoning Sandwich 상태 초기화 ──
        const sandwichEnabled = REASONING_SANDWICH.ENABLED;
        const sandwichTransitions: Array<{ step: number; phase: SandwichPhase; level: string }> = [];
        let currentPhase: SandwichPhase = 'plan';

        // ExecutionState 초기화 (외부에서 전달받았으면 공유, 없으면 새로 생성)
        if (!context.executionState) {
            context.executionState = { turnsUsed: 0, startTime };
        }

        // Sandwich 초기 레벨 설정 (plan 페이즈)
        if (sandwichEnabled) {
            sandwichTransitions.push({ step: 0, phase: 'plan', level: REASONING_SANDWICH.PLAN_LEVEL });
            logger.info(`🥪 Reasoning Sandwich 활성: plan=${REASONING_SANDWICH.PLAN_LEVEL}, exec=${REASONING_SANDWICH.EXEC_LEVEL}, verify=${REASONING_SANDWICH.VERIFY_LEVEL}`);
        }

        // 예산 인식 시스템 프롬프트 주입 (원본 히스토리 오염 방지를 위해 복사)
        const budgetHint = buildBudgetAwarePrompt(context.userLanguage);
        const historyCopy = [...context.currentHistory];
        if (historyCopy.length > 0 && historyCopy[0].role === 'system') {
            historyCopy[0] = {
                ...historyCopy[0],
                content: historyCopy[0].content + `\n\n${budgetHint}`,
            };
        }

        // AgentLoop에 전달할 컨텍스트 (참조형으로 thinkingLevel 동적 변경 가능)
        const agentContext: AgentLoopStrategyContext = {
            ...context,
            currentHistory: historyCopy,
            thinkingLevel: sandwichEnabled ? REASONING_SANDWICH.PLAN_LEVEL : context.thinkingLevel,
            maxTurns: Math.min(context.maxTurns, THINKING_LIMITS.MAX_STEPS),
            onToken: undefined as unknown as (token: string, thinking?: string) => void, // 아래에서 할당
        };

        // 페이즈 역행 방지를 위한 우선순위 맵
        const PHASE_ORDER: Record<SandwichPhase, number> = { plan: 0, exec: 1, verify: 2 };

        // 단계 추적용 래퍼: 스트리밍 토큰을 가로채서 단계/예산 추적
        const stepPattern = /\[(\d+)\/(\d+)\]/;
        let currentBuffer = '';

        const originalOnToken = context.onToken;
        const trackingOnToken = (token: string, thinking?: string) => {
            // thinking 토큰은 사고 과정으로 간주
            if (thinking) {
                thinkingCharsUsed += thinking.length;
            }

            currentBuffer += token;
            thinkingCharsUsed += token.length;

            // [N/M] 패턴 감지하여 단계 추적
            const match = currentBuffer.match(stepPattern);
            if (match) {
                const stepNum = parseInt(match[1], 10);
                const maxStep = parseInt(match[2], 10);
                if (stepNum > thinkingSteps) {
                    thinkingSteps = stepNum;
                    logger.info(`🧠 Thinking Step ${stepNum}: ${thinkingCharsUsed}/${THINKING_LIMITS.MAX_THINK_CHARS} chars`);

                    // ── Reasoning Sandwich: 페이즈 전환 (단방향만 허용) ──
                    if (sandwichEnabled && maxStep > 0) {
                        const newPhase = determineSandwichPhase(stepNum, maxStep);
                        if (PHASE_ORDER[newPhase] > PHASE_ORDER[currentPhase]) {
                            currentPhase = newPhase;
                            const newLevel = getSandwichLevel(newPhase);
                            agentContext.thinkingLevel = newLevel;
                            sandwichTransitions.push({ step: stepNum, phase: newPhase, level: newLevel });
                            logger.info(`🥪 Sandwich 페이즈 전환: ${newPhase} (level=${newLevel}) at step ${stepNum}/${maxStep}`);
                        }
                    }
                }
                currentBuffer = '';
            }

            // 버퍼 overflow 방지
            if (currentBuffer.length > 200) {
                currentBuffer = currentBuffer.slice(-50);
            }

            originalOnToken(token, thinking);
        };

        agentContext.onToken = trackingOnToken;

        // AgentLoop 실행 (래핑된 onToken, 동적 thinkingLevel 참조)
        const result = await this.agentLoopStrategy.execute(agentContext);

        // 예산 초과 판정
        if (thinkingCharsUsed >= THINKING_LIMITS.MAX_THINK_CHARS * THINKING_LIMITS.FORCE_CONCLUSION_AT) {
            conclusionForced = true;
            logger.info(`⚠️ Thinking 예산 ${Math.round((thinkingCharsUsed / THINKING_LIMITS.MAX_THINK_CHARS) * 100)}% 사용 — 결론 강제됨`);
        }

        // 단계 수 최소 보정 (패턴 미감지 시 응답 길이 기반 추정)
        if (thinkingSteps === 0 && result.response.length > THINKING_LIMITS.MIN_STEP_CONTENT_CHARS) {
            thinkingSteps = 1;
        }

        // Load-bearing Verification: 결론-과정 일관성 검증 (opt-in)
        let verificationPassed: boolean | undefined;
        if (THINKING_LIMITS.VERIFY_CONCLUSION && result.response.length > 0) {
            verificationPassed = await verifyConclusionConsistency(
                result.response, context.userLanguage
            );
            if (!verificationPassed) {
                logger.warn('⚠️ Thinking 결론-과정 일관성 검증 실패');
            }
        }

        const elapsed = Date.now() - startTime;
        logger.info(
            `✅ Thinking 완료: ${thinkingSteps}단계, ${thinkingCharsUsed}자, ${elapsed}ms, 결론강제=${conclusionForced}` +
            (verificationPassed != null ? `, 검증=${verificationPassed}` : '') +
            (sandwichEnabled ? `, 🥪 Sandwich 전환=${sandwichTransitions.length}회` : '')
        );

        return {
            response: result.response,
            metrics: {
                ...result.metrics,
                thinkingSteps,
                thinkingCharsUsed,
                conclusionForced,
                thinkingElapsedMs: elapsed,
                verificationPassed,
                ...(sandwichEnabled && {
                    sandwichApplied: true,
                    sandwichTransitions: sandwichTransitions.length,
                }),
            },
            thinkingSteps,
            thinkingCharsUsed,
            conclusionForced,
            verificationPassed,
            sandwichApplied: sandwichEnabled,
            sandwichTransitions: sandwichEnabled ? sandwichTransitions : undefined,
        };
    }
}

/**
 * Reasoning Sandwich: 현재 단계에 해당하는 페이즈를 결정합니다.
 *
 * - plan: 처음 PLAN_STEPS_RATIO 구간 (기본 20%)
 * - verify: 마지막 VERIFY_STEPS_RATIO 구간 (기본 10%)
 * - exec: 그 사이 구간
 *
 * @param currentStep - 현재 단계 번호 (1-based)
 * @param maxSteps - 전체 단계 수
 * @returns 현재 페이즈
 */
function determineSandwichPhase(currentStep: number, maxSteps: number): SandwichPhase {
    const progress = currentStep / maxSteps;
    if (progress <= REASONING_SANDWICH.PLAN_STEPS_RATIO) {
        return 'plan';
    }
    if (progress > 1 - REASONING_SANDWICH.VERIFY_STEPS_RATIO) {
        return 'verify';
    }
    return 'exec';
}

/**
 * 페이즈에 해당하는 추론 레벨을 반환합니다.
 */
function getSandwichLevel(phase: SandwichPhase): 'low' | 'medium' | 'high' {
    switch (phase) {
        case 'plan': return REASONING_SANDWICH.PLAN_LEVEL;
        case 'exec': return REASONING_SANDWICH.EXEC_LEVEL;
        case 'verify': return REASONING_SANDWICH.VERIFY_LEVEL;
    }
}

/**
 * 결론-과정 일관성 검증 (Load-bearing Verification)
 *
 * 소형 모델(Verifier)로 "결론이 사고 과정에서 논리적으로 도출되었는가"를 판단합니다.
 * THINKING_LIMITS.VERIFY_CONCLUSION === true 일 때만 호출됩니다.
 *
 * @param response - ThinkingStrategy의 전체 응답
 * @param language - 사용자 언어
 * @returns true이면 검증 통과, false이면 불일치 감지
 */
async function verifyConclusionConsistency(
    response: string,
    language?: string,
): Promise<boolean> {
    try {
        // 결론 부분 추출
        const conclusionMatch = response.match(/## (?:결론|Conclusion)\s*\n([\s\S]*?)(?:\n---|\n##|$)/);
        if (!conclusionMatch) {
            // 결론 섹션이 없으면 검증 스킵 (통과 처리)
            return true;
        }
        const conclusion = conclusionMatch[1].trim().substring(0, 500);
        const reasoning = response.substring(response.indexOf('---') + 3).trim().substring(0, 1500);

        if (!reasoning || reasoning.length < 50) {
            return true; // 사고 과정이 너무 짧으면 스킵
        }

        const prompt = language === 'ko' || language === 'ja' || language === 'zh'
            ? `아래 결론이 사고 과정에서 논리적으로 도출되었는지 판단하세요. "YES" 또는 "NO"만 답하세요.\n\n결론:\n${conclusion}\n\n사고 과정:\n${reasoning}`
            : `Determine if the conclusion logically follows from the reasoning below. Answer only "YES" or "NO".\n\nConclusion:\n${conclusion}\n\nReasoning:\n${reasoning}`;

        const verifierClient = new OllamaClient({ model: THINKING_LIMITS.VERIFIER_MODEL });
        const verifyResponse = await verifierClient.chat(
            [{ role: 'user', content: prompt }],
            { num_predict: THINKING_LIMITS.VERIFIER_MAX_TOKENS }
        );

        return verifyResponse.content.trim().toUpperCase().startsWith('YES');
    } catch (e) {
        logger.warn('결론 검증 실패 (무시):', e instanceof Error ? e.message : e);
        return true; // 검증 실패 시 통과 처리 (Graceful Degradation)
    }
}

/**
 * 예산 인식 사고 지시 프롬프트를 생성합니다.
 *
 * @param language - 사용자 언어
 * @returns 시스템 프롬프트에 추가할 예산 제어 지시문
 */
function buildBudgetAwarePrompt(language?: string): string {
    const maxSteps = THINKING_LIMITS.MAX_STEPS;
    const budgetChars = THINKING_LIMITS.MAX_THINK_CHARS;
    const budgetTokensApprox = Math.round(budgetChars / CAPACITY.TOKEN_TO_CHAR_RATIO);

    if (language === 'ko' || language === 'ja' || language === 'zh') {
        return [
            `[Sprint Contract] 단계별 사고 예산:`,
            `- 최대 ${maxSteps}단계, 약 ${budgetTokensApprox} 토큰`,
            `- 각 단계를 [단계번호/${maxSteps}] 형식으로 표시`,
            `- 예산의 80%를 넘기면 반드시 결론으로 마무리`,
            `- 결론을 "## 결론" 제목으로 맨 먼저 제시한 후 사고 과정 표시`,
        ].join('\n');
    }

    return [
        `[Sprint Contract] Step-by-step thinking budget:`,
        `- Maximum ${maxSteps} steps, ~${budgetTokensApprox} tokens`,
        `- Mark each step as [step/${maxSteps}]`,
        `- If 80% of budget is used, wrap up with a conclusion`,
        `- Present conclusion under "## Conclusion" first, then show reasoning`,
    ].join('\n');
}
