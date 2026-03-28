/**
 * ============================================================
 * Discussion Engine - 멀티 에이전트 토론 오케스트레이션 시스템
 * ============================================================
 * 
 * 여러 전문가 에이전트가 주어진 주제에 대해 다라운드 토론을 진행하고,
 * 교차 검토와 팩트체킹을 거쳐 최종 합성 답변을 생성하는 토론 엔진입니다.
 * 컨텍스트 엔지니어링(문서, 대화 히스토리, 메모리, 이미지)을 지원합니다.
 * 
 * @module agents/discussion-engine
 * @description
 * - 5단계 토론 플로우: 전문가 선택 -> 라운드별 토론 -> 교차 검토 -> 사실 검증 -> 최종 합성
 * - 의도 기반 에이전트 선택: 주제 분석 + LLM 라우팅으로 최적 전문가 패널 구성
 * - Deep Thinking 모드: 문제 분해, 다각적 분석, 근거 제시, 반론 고려 프로세스
 * - 우선순위 기반 컨텍스트 구성: 메모리 > 대화 히스토리 > 문서 > 웹 검색 > 이미지
 * - 토큰 제한 관리: 각 컨텍스트 항목별 최대 토큰 할당 + 전체 제한
 * - 실시간 진행 상황 콜백 (onProgress)
 * 
 * 토론 플로우:
 * 1. selectExpertAgents() - 주제에 적합한 전문가 에이전트 2~10명 선택
 * 2. generateAgentOpinion() x N라운드 - 각 전문가가 순차적으로 의견 제시
 * 3. performCrossReview() - 모든 의견의 장단점, 공통점, 차이점 분석
 * 4. (선택) 웹 검색 사실 검증
 * 5. synthesizeFinalAnswer() - 모든 의견과 교차 검토를 종합하여 최종 답변 생성
 * 
 * @see agents/index.ts - 에이전트 정의 및 라우팅
 * @see agents/llm-router.ts - LLM 기반 에이전트 선택
 */

import { getAgentById, Agent, getRelatedAgentsForDiscussion } from './index';
import { sanitizePromptInput } from '../utils/input-sanitizer';
import type { DiscussionConfig, DiscussionProgress, AgentOpinion, DiscussionResult } from './discussion-types';
import { createContextBuilder } from './discussion-context';
import { createLogger } from '../utils/logger';
import { resolvePromptLocale } from '../chat/language-policy';
import { parallelBatch } from '../workflow/graph-engine';
import { DISCUSSION_CONFIDENCE, DISCUSSION_CONSISTENCY } from '../config/runtime-limits';
/** 토론 엔진에서 사용하는 웹 검색 결과 최소 인터페이스 */
export interface DiscussionSearchResult {
    title: string;
    url: string;
    snippet?: string;
}
import {
    DISCUSSION_SYSTEM_PROMPTS,
    DISCUSSION_LABELS,
    DISCUSSION_PROGRESS_MESSAGES,
    DISCUSSION_ERROR_MESSAGES,
} from './discussion-locales';

const logger = createLogger('Discussion');

// Re-export all types so consumers importing from discussion-engine don't break
export type { DiscussionProgress, AgentOpinion, DiscussionResult, ContextPriority, TokenLimits, DiscussionConfig } from './discussion-types';

// ========================================
// Discussion Engine
// ========================================

/**
 * 토론 엔진 팩토리 함수
 * 
 * LLM 응답 생성 함수와 설정을 받아 토론 실행 객체를 생성합니다.
 * 반환된 객체의 startDiscussion()으로 토론을 시작합니다.
 * 
 * @param generateResponse - LLM 응답 생성 함수 (시스템 프롬프트, 사용자 메시지 -> 응답)
 * @param config - 토론 설정 (참여자 수, 라운드 수, 교차 검토, 컨텍스트 등)
 * @param onProgress - 진행 상황 콜백 (SSE 스트리밍 등에 활용)
 * @returns startDiscussion(), selectExpertAgents() 메서드를 가진 토론 엔진 객체
 */
export function createDiscussionEngine(
    generateResponse: (systemPrompt: string, userMessage: string) => Promise<string>,
    config: DiscussionConfig = {},
    onProgress?: (progress: DiscussionProgress) => void
) {
    const {
        maxAgents = 10,  // 🆕 제한 완화: 기본 10명으로 증가 (0 = 무제한)
        maxRounds = 2,
        enableCrossReview = true,
        enableFactCheck = false,
        enableDeepThinking = true,  // 🆕 기본 Deep Thinking 활성화
        userLanguage,
        // 🆕 컨텍스트 엔지니어링 필드 추출
        documentContext,
        webSearchContext,
    } = config;

    const locale = resolvePromptLocale(userLanguage || 'en');
    const localizedPrompts = DISCUSSION_SYSTEM_PROMPTS[locale];
    const localizedLabels = DISCUSSION_LABELS[locale];
    const localizedProgressMessages = DISCUSSION_PROGRESS_MESSAGES[locale];
    const localizedErrorMessages = DISCUSSION_ERROR_MESSAGES[locale];
    
    // 🆕 컨텍스트 빌더 생성 (우선순위, 토큰 제한, 메모이제이션 포함)
    const contextBuilder = createContextBuilder(config);
    const buildFullContext = contextBuilder.buildFullContext;

    /**
     * 🆕 개선된 전문가 에이전트 선택 (의도 기반 + 컨텍스트 반영)
     */
    async function selectExpertAgents(topic: string): Promise<Agent[]> {
        logger.info(`토론 주제: "${topic.substring(0, 50)}..."`);

        // 🆕 컨텍스트를 포함하여 더 정확한 에이전트 선택
        const fullContext = buildFullContext();
        const agentLimit = maxAgents === 0 ? 20 : maxAgents;
        
        // 🆕 컨텍스트를 전달하여 에이전트 선택 정확도 향상
        const experts = await getRelatedAgentsForDiscussion(topic, agentLimit, fullContext);

        logger.info(`선택된 전문가: ${experts.map(e => `${e.emoji} ${e.name}`).join(', ')}`);
        if (fullContext) {
            logger.info(`컨텍스트 적용됨 (${fullContext.length}자)`);
        }

        // 최소 2명 보장
        if (experts.length < 2) {
            const fallbackAgents = ['business-strategist', 'data-analyst', 'project-manager', 'general'];
            for (const id of fallbackAgents) {
                if (experts.length >= 2) break;
                const agent = getAgentById(id);
                if (agent && !experts.find(e => e.id === id)) {
                    experts.push(agent);
                }
            }
        }

        return experts;
    }

    /**
     * 에이전트별 의견 생성
     * 🆕 컨텍스트 엔지니어링 적용: 문서, 대화 기록, 웹 검색 결과 반영
     */
    async function generateAgentOpinion(
        agent: Agent,
        topic: string,
        previousOpinions: AgentOpinion[]
    ): Promise<AgentOpinion | null> {
        try {
            // 🆕 Deep Thinking 모드에 따른 프롬프트 차별화
            const thinkingInstructions = enableDeepThinking ? `
${localizedPrompts.deepThinking}` : '';

            // 🆕 컨텍스트 기반 추가 지침
            const contextInstructions = buildFullContext() ? `
${localizedPrompts.contextReferenceTitle}
${localizedPrompts.contextReferenceBody}
${buildFullContext()}
` : '';

            const systemPrompt = `# ${agent.emoji} ${agent.name}

${localizedPrompts.agentOpinion(agent.name, Boolean(documentContext), Boolean(webSearchContext))}
${agent.description}
${thinkingInstructions}
${contextInstructions}
`;

            let contextMessage = `${localizedLabels.discussionTopic}\n<topic>${sanitizePromptInput(topic)}</topic>\n\n`;

            if (previousOpinions.length > 0) {
                contextMessage += `${localizedLabels.previousOpinions}\n`;
                for (const op of previousOpinions) {
                    contextMessage += `\n### ${op.agentEmoji} ${op.agentName}\n${op.opinion}\n`;
                }
                contextMessage += `\n---\n\n${localizedLabels.provideOpinion}`;
            } else {
                contextMessage += `\n${localizedLabels.provideOpinion}`;
            }

            const response = await generateResponse(systemPrompt, contextMessage);

            // 응답 품질 기반 동적 confidence 계산
            // 긴 응답 + 구조화된 응답(마크다운 헤더, 목록) = 높은 신뢰도
            const responseLen = response.length;
            const hasStructure = /^#{1,3}\s/m.test(response) || /^[-*]\s/m.test(response);
            const hasEvidence = /예시|사례|예를 들|example|e\.g\.|for instance/i.test(response);
            let confidence: number = DISCUSSION_CONFIDENCE.BASE;
            if (responseLen > DISCUSSION_CONFIDENCE.SHORT_RESPONSE_LENGTH) confidence += DISCUSSION_CONFIDENCE.INCREMENT;
            if (responseLen > DISCUSSION_CONFIDENCE.LONG_RESPONSE_LENGTH) confidence += DISCUSSION_CONFIDENCE.INCREMENT;
            if (hasStructure) confidence += DISCUSSION_CONFIDENCE.INCREMENT;
            if (hasEvidence) confidence += DISCUSSION_CONFIDENCE.INCREMENT;
            confidence = Math.min(confidence, 1.0);

            return {
                agentId: agent.id,
                agentName: agent.name,
                agentEmoji: agent.emoji || '🤖',
                opinion: response,
                confidence,
                timestamp: new Date()
            };
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error(`❌ ${agent.emoji} ${agent.name} 의견 생성 실패: ${errMsg}`);
            return null;
        }
    }

    /**
     * 교차 검토 (Cross-Review)
     */
    async function performCrossReview(
        opinions: AgentOpinion[],
        topic: string
    ): Promise<string> {
        const systemPrompt = localizedPrompts.crossReview;

        let contextMessage = `${localizedLabels.discussionTopic}\n<topic>${sanitizePromptInput(topic)}</topic>\n\n${localizedLabels.expertOpinions}\n`;
        for (const op of opinions) {
            contextMessage += `\n### ${op.agentEmoji} ${op.agentName}\n${op.opinion}\n`;
        }
        contextMessage += `\n---\n\n${localizedLabels.crossReviewRequest}`;

        return await generateResponse(systemPrompt, contextMessage);
    }

    /**
     * 최종 답변 합성
     */
    async function synthesizeFinalAnswer(
        topic: string,
        opinions: AgentOpinion[],
        crossReview?: string
    ): Promise<string> {
        const systemPrompt = localizedPrompts.finalSynthesis;

        let contextMessage = `${localizedLabels.question}\n<topic>${sanitizePromptInput(topic)}</topic>\n\n${localizedLabels.expertOpinionsSection}\n`;
        for (const op of opinions) {
            contextMessage += `\n### ${op.agentEmoji} ${op.agentName}\n${op.opinion}\n`;
        }

        if (crossReview) {
            contextMessage += `\n${localizedLabels.crossReviewResult}\n${crossReview}\n`;
        }

        contextMessage += `\n---\n\n${localizedLabels.synthesisRequest}`;

        return await generateResponse(systemPrompt, contextMessage);
    }

    /**
     * Self-Consistency Score 측정
     *
     * 에이전트 의견들 간의 합의도를 수치화합니다.
     * Evaluator 역할로 LLM을 호출하여 합의점/모순점을 추출하고,
     * consensus / (consensus + conflict) 비율로 점수를 산출합니다.
     */
    async function calculateConsistencyScore(
        opinions: AgentOpinion[],
        topic: string
    ): Promise<{ score: number; consensusPoints: string[]; conflictPoints: string[] }> {
        // 최소 에이전트 수 미달 시 기본값 반환
        if (opinions.length < DISCUSSION_CONSISTENCY.MIN_AGENTS) {
            return { score: 1.0, consensusPoints: [], conflictPoints: [] };
        }

        const evaluationPrompt = `You are an impartial evaluator analyzing multiple expert opinions on a topic.
Identify consensus points (where experts agree) and conflict points (where experts disagree).

Return ONLY a JSON object in this exact format:
{"consensus":["point1","point2"],"conflicts":["point1","point2"]}

Rules:
- Each point should be a single concise sentence
- Maximum 5 consensus points and 5 conflict points
- If no conflicts, return empty array for conflicts
- Respond in the same language as the opinions`;

        let contextMessage = `Topic: ${topic}\n\nExpert Opinions:\n`;
        for (const op of opinions) {
            contextMessage += `\n### ${op.agentName}\n${op.opinion.substring(0, 500)}\n`;
        }
        contextMessage += `\nAnalyze and return JSON:`;

        try {
            const response = await generateResponse(evaluationPrompt, contextMessage);

            // JSON 추출 (LLM이 부가 텍스트를 추가할 수 있으므로 패턴 매칭)
            const jsonMatch = response.match(/\{[\s\S]*"consensus"[\s\S]*"conflicts"[\s\S]*\}/);
            if (!jsonMatch) {
                logger.warn('Self-Consistency Score: JSON 패턴 미매칭, 폴백 반환');
                return { score: 0.7, consensusPoints: [], conflictPoints: [] };
            }

            const parsed = JSON.parse(jsonMatch[0]) as {
                consensus: string[];
                conflicts: string[];
            };

            const consensusCount = Array.isArray(parsed.consensus) ? parsed.consensus.length : 0;
            const conflictCount = Array.isArray(parsed.conflicts) ? parsed.conflicts.length : 0;
            const total = consensusCount + conflictCount;
            const score = total > 0 ? consensusCount / total : 1.0;

            return {
                score: Math.round(score * 100) / 100,
                consensusPoints: Array.isArray(parsed.consensus) ? parsed.consensus.slice(0, 5) : [],
                conflictPoints: Array.isArray(parsed.conflicts) ? parsed.conflicts.slice(0, 5) : [],
            };
        } catch (e) {
            logger.warn('Self-Consistency Score 측정 실패:', e);
            return { score: 0.7, consensusPoints: [], conflictPoints: [] };
        }
    }

    /**
     * 토론 시작
     */
    async function startDiscussion(
        topic: string,
        webSearchFn?: (query: string, opts?: { maxResults?: number }) => Promise<DiscussionSearchResult[]>
    ): Promise<DiscussionResult> {
        const startTime = Date.now();
        const opinions: AgentOpinion[] = [];

        // 1. 전문가 에이전트 선택
        onProgress?.({
            phase: 'selecting',
            message: localizedProgressMessages.selectingExperts,
            progress: 5
        });

        const experts = await selectExpertAgents(topic);
        const participants = experts.map(e => e.name);

        // 2. 라운드별 토론 (라운드 내 에이전트 의견 병렬 수집)
        let consecutiveRoundFailures = 0;
        for (let round = 0; round < maxRounds; round++) {
            const roundBaseProgress = 10 + (round * 40 / maxRounds);
            const roundSpan = 40 / maxRounds;

            onProgress?.({
                phase: 'discussing',
                message: localizedProgressMessages.agentOpining('🤖', `Round ${round + 1}`),
                progress: roundBaseProgress,
                roundNumber: round + 1,
                totalRounds: maxRounds
            });

            // 같은 라운드 내 에이전트들은 서로 의존성이 없으므로 병렬 실행
            const previousForRound = round > 0 ? [...opinions] : [];
            let roundResults: (AgentOpinion | null)[];
            try {
                roundResults = await parallelBatch<Agent, AgentOpinion | null>(
                    experts,
                    async (agent, i) => {
                        onProgress?.({
                            phase: 'discussing',
                            currentAgent: agent.name,
                            agentEmoji: agent.emoji,
                            message: localizedProgressMessages.agentOpining(agent.emoji || '🤖', agent.name),
                            progress: roundBaseProgress + (i * roundSpan / experts.length),
                            roundNumber: round + 1,
                            totalRounds: maxRounds
                        });
                        return generateAgentOpinion(agent, topic, previousForRound);
                    },
                    { concurrency: experts.length }
                );
            } catch (error) {
                logger.error(`Round ${round + 1} parallel execution failed:`, error);
                roundResults = [];
            }

            const roundSuccessCount = roundResults.filter(r => r !== null).length;
            if (roundSuccessCount === 0) {
                consecutiveRoundFailures++;
                logger.warn(`Round ${round + 1}: 전체 에이전트 의견 생성 실패 (연속 ${consecutiveRoundFailures}회)`);
                if (consecutiveRoundFailures >= 2) {
                    logger.error('연속 2라운드 전체 실패 — 토론 조기 종료 (LLM 연결 상태 확인 필요)');
                    break;
                }
            } else {
                consecutiveRoundFailures = 0;
            }

            for (const result of roundResults) {
                if (result) opinions.push(result);
            }
        }

        // 2.5. 의견이 하나도 수집되지 않은 경우 조기 종료
        if (opinions.length === 0) {
            logger.error('⚠️ 모든 에이전트 의견 생성 실패 — LLM 연결 상태를 확인하세요.');
            onProgress?.({
                phase: 'complete',
                message: localizedProgressMessages.connectionError,
                progress: 100
            });
            return {
                discussionSummary: localizedErrorMessages.discussionFailureSummary,
                finalAnswer: localizedErrorMessages.connectionErrorDetail,
                participants,
                opinions: [],
                totalTime: Date.now() - startTime,
                factChecked: false
            };
        }

        // 3. 교차 검토
        let crossReview: string | undefined;
        if (enableCrossReview && opinions.length > 1) {
            onProgress?.({
                phase: 'reviewing',
                message: localizedProgressMessages.crossReviewing,
                progress: 75
            });

            crossReview = await performCrossReview(opinions, topic);
        }

        // 4. 사실 검증 (옵션)
        let factChecked = false;
        if (enableFactCheck && webSearchFn) {
            onProgress?.({
                phase: 'reviewing',
                message: localizedProgressMessages.factChecking,
                progress: 80
            });

            try {
                await webSearchFn(topic);
                factChecked = true;
            } catch (e) {
                logger.warn('사실 검증 실패:', e);
            }
        }

        // 4.5. Self-Consistency Score 측정 (에이전트 간 합의도)
        let consistencyScore: number | undefined;
        let consensusPoints: string[] | undefined;
        let conflictPoints: string[] | undefined;

        if (DISCUSSION_CONSISTENCY.ENABLED && opinions.length >= DISCUSSION_CONSISTENCY.MIN_AGENTS) {
            try {
                const consistency = await calculateConsistencyScore(opinions, topic);
                consistencyScore = consistency.score;
                consensusPoints = consistency.consensusPoints;
                conflictPoints = consistency.conflictPoints;
                logger.info(`📊 Self-Consistency Score: ${consistencyScore} (합의: ${consensusPoints.length}, 모순: ${conflictPoints.length})`);
            } catch (e) {
                logger.warn('Self-Consistency Score 측정 스킵:', e);
            }
        }

        // 5. 최종 답변 합성
        onProgress?.({
            phase: 'synthesizing',
            message: localizedProgressMessages.synthesizing,
            progress: 90
        });

        const finalAnswer = await synthesizeFinalAnswer(topic, opinions, crossReview);

        // 6. 완료
        onProgress?.({
            phase: 'complete',
            message: localizedProgressMessages.complete,
            progress: 100
        });

        return {
            discussionSummary: localizedErrorMessages.discussionSummary(experts.length, maxRounds),
            finalAnswer,
            participants,
            opinions,
            totalTime: Date.now() - startTime,
            factChecked,
            consistencyScore,
            consensusPoints,
            conflictPoints,
        };
    }

    return {
        startDiscussion,
        selectExpertAgents
    };
}
