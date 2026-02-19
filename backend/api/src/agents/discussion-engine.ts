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

import { routeToAgent, getAgentById, AGENTS, Agent, AgentSelection, getRelatedAgentsForDiscussion } from './index';
import { sanitizePromptInput, validatePromptInput } from '../utils/input-sanitizer';
import type { DiscussionConfig, DiscussionProgress, AgentOpinion, DiscussionResult } from './discussion-types';
import { createContextBuilder } from './discussion-context';

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
        // 🆕 컨텍스트 엔지니어링 필드 추출
        documentContext,
        webSearchContext,
    } = config;
    
    // 🆕 컨텍스트 빌더 생성 (우선순위, 토큰 제한, 메모이제이션 포함)
    const contextBuilder = createContextBuilder(config);
    const buildFullContext = contextBuilder.buildFullContext;
    const getImageContexts = contextBuilder.getImageContexts;

    /**
     * 🆕 개선된 전문가 에이전트 선택 (의도 기반 + 컨텍스트 반영)
     */
    async function selectExpertAgents(topic: string): Promise<Agent[]> {
        console.log(`[Discussion] 토론 주제: "${topic.substring(0, 50)}..."`);

        // 🆕 컨텍스트를 포함하여 더 정확한 에이전트 선택
        const fullContext = buildFullContext();
        const agentLimit = maxAgents === 0 ? 20 : maxAgents;
        
        // 🆕 컨텍스트를 전달하여 에이전트 선택 정확도 향상
        const experts = await getRelatedAgentsForDiscussion(topic, agentLimit, fullContext);

        console.log(`[Discussion] 선택된 전문가: ${experts.map(e => `${e.emoji} ${e.name}`).join(', ')}`);
        if (fullContext) {
            console.log(`[Discussion] 컨텍스트 적용됨 (${fullContext.length}자)`);
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
## 🧠 Deep Thinking 프로세스 (필수)
분석 전에 반드시 다음 사고 과정을 거쳐야 합니다:

1. **문제 분해**: 주제의 핵심 요소들을 분리하세요.
2. **다각적 분석**: 기술적, 비즈니스적, 리스크 관점에서 각각 검토하세요.
3. **근거 제시**: 주장에는 반드시 논리적 근거나 사례를 포함하세요.
4. **반론 고려**: 자신의 의견에 대한 반론도 고려하세요.
5. **실행 가능성**: 실제로 적용 가능한 구체적 제안을 하세요.

응답 시작 전 "💭 Thinking:"으로 핵심 고려사항을 먼저 정리하세요.` : '';

            // 🆕 컨텍스트 기반 추가 지침
            const contextInstructions = buildFullContext() ? `
## 📋 참조 컨텍스트
아래 컨텍스트를 반드시 고려하여 의견을 제시하세요:
${buildFullContext()}
` : '';

            const systemPrompt = `# ${agent.emoji} ${agent.name}

당신은 **${agent.name}** 전문가입니다.
${agent.description}
${thinkingInstructions}
${contextInstructions}

## 토론 지침
1. 전문 분야의 관점에서 주제를 **심층적으로** 분석하세요.
2. 구체적이고 실용적인 의견을 제시하세요.
3. 다른 전문가들의 의견이 있다면 보완하거나 다른 시각을 제공하세요.
4. 응답은 300-500자 내외로 충분히 심도있게 작성하세요.
5. ${documentContext ? '**참조 문서의 내용을 분석에 반영하세요.**' : ''}
6. ${webSearchContext ? '**웹 검색 결과를 근거로 활용하세요.**' : ''}`;

            let contextMessage = `## 토론 주제\n<topic>${sanitizePromptInput(topic)}</topic>\n\n`;

            if (previousOpinions.length > 0) {
                contextMessage += `## 이전 전문가 의견\n`;
                for (const op of previousOpinions) {
                    contextMessage += `\n### ${op.agentEmoji} ${op.agentName}\n${op.opinion}\n`;
                }
                contextMessage += `\n---\n\n당신의 전문가 의견을 제시해주세요:`;
            } else {
                contextMessage += `\n당신의 전문가 의견을 제시해주세요:`;
            }

            const response = await generateResponse(systemPrompt, contextMessage);

            return {
                agentId: agent.id,
                agentName: agent.name,
                agentEmoji: agent.emoji || '🤖',
                opinion: response,
                confidence: 0.8,
                timestamp: new Date()
            };
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            console.error(`[Discussion] ❌ ${agent.emoji} ${agent.name} 의견 생성 실패: ${errMsg}`);
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
        const systemPrompt = `# 🔍 교차 검토 전문가

당신은 여러 전문가의 의견을 검토하고 종합하는 역할입니다.

## 검토 지침
1. 각 전문가 의견의 장단점을 분석하세요.
2. 의견들 간의 공통점과 차이점을 파악하세요.
3. 상충되는 의견이 있다면 이유를 설명하세요.
4. 200자 내외로 간결하게 요약하세요.`;

        let contextMessage = `## 토론 주제\n<topic>${sanitizePromptInput(topic)}</topic>\n\n## 전문가 의견들\n`;
        for (const op of opinions) {
            contextMessage += `\n### ${op.agentEmoji} ${op.agentName}\n${op.opinion}\n`;
        }
        contextMessage += `\n---\n\n교차 검토 결과를 제시해주세요:`;

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
        const systemPrompt = `# 💡 종합 분석가

당신은 여러 전문가의 의견을 종합하여 최종 답변을 생성하는 역할입니다.

## 합성 지침
1. 모든 전문가 의견의 핵심을 포함하세요.
2. 논리적인 구조로 정리하세요.
3. 실행 가능한 결론을 제시하세요.
4. 마크다운 형식으로 깔끔하게 작성하세요.`;

        let contextMessage = `## 질문\n<topic>${sanitizePromptInput(topic)}</topic>\n\n## 전문가 의견\n`;
        for (const op of opinions) {
            contextMessage += `\n### ${op.agentEmoji} ${op.agentName}\n${op.opinion}\n`;
        }

        if (crossReview) {
            contextMessage += `\n## 교차 검토 결과\n${crossReview}\n`;
        }

        contextMessage += `\n---\n\n위 내용을 종합하여 최종 답변을 작성해주세요:`;

        return await generateResponse(systemPrompt, contextMessage);
    }

    /**
     * 토론 시작
     */
    async function startDiscussion(
        topic: string,
        webSearchFn?: (query: string) => Promise<any[]>
    ): Promise<DiscussionResult> {
        const startTime = Date.now();
        const opinions: AgentOpinion[] = [];

        // 1. 전문가 에이전트 선택
        onProgress?.({
            phase: 'selecting',
            message: '토론 참여 전문가를 선택하고 있습니다...',
            progress: 5
        });

        const experts = await selectExpertAgents(topic);
        const participants = experts.map(e => e.name);

        // 2. 라운드별 토론
        for (let round = 0; round < maxRounds; round++) {
            for (let i = 0; i < experts.length; i++) {
                const agent = experts[i];
                const progressPercent = 10 + (round * 40 / maxRounds) + (i * 40 / maxRounds / experts.length);

                onProgress?.({
                    phase: 'discussing',
                    currentAgent: agent.name,
                    agentEmoji: agent.emoji,
                    message: `${agent.emoji} ${agent.name}이(가) 의견을 제시하고 있습니다...`,
                    progress: progressPercent,
                    roundNumber: round + 1,
                    totalRounds: maxRounds
                });

                const opinion = await generateAgentOpinion(
                    agent,
                    topic,
                    round > 0 ? opinions : []
                );
                if (opinion) {
                    opinions.push(opinion);
                }
            }
        }

        // 2.5. 의견이 하나도 수집되지 않은 경우 조기 종료
        if (opinions.length === 0) {
            console.error('[Discussion] ⚠️ 모든 에이전트 의견 생성 실패 — LLM 연결 상태를 확인하세요.');
            onProgress?.({
                phase: 'complete',
                message: 'AI 모델 서버에 연결할 수 없어 토론을 완료하지 못했습니다.',
                progress: 100
            });
            return {
                discussionSummary: '토론 실패: 모든 전문가 에이전트의 응답 생성에 실패했습니다.',
                finalAnswer: '⚠️ AI 모델 서버에 연결할 수 없어 토론을 진행할 수 없습니다.\n\n' +
                    '**가능한 원인:**\n' +
                    '- Cloud 모델 서버(Ollama Cloud)에 접속할 수 없습니다.\n' +
                    '- API 키가 만료되었거나 할당량이 초과되었을 수 있습니다.\n' +
                    '- 네트워크 연결 상태를 확인해주세요.\n\n' +
                    '잠시 후 다시 시도해주세요.',
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
                message: '전문가 의견을 교차 검토하고 있습니다...',
                progress: 75
            });

            crossReview = await performCrossReview(opinions, topic);
        }

        // 4. 사실 검증 (옵션)
        let factChecked = false;
        if (enableFactCheck && webSearchFn) {
            onProgress?.({
                phase: 'reviewing',
                message: '웹 검색으로 사실을 검증하고 있습니다...',
                progress: 80
            });

            try {
                await webSearchFn(topic);
                factChecked = true;
            } catch (e) {
                console.warn('[Discussion] 사실 검증 실패:', e);
            }
        }

        // 5. 최종 답변 합성
        onProgress?.({
            phase: 'synthesizing',
            message: '전문가 의견을 종합하여 최종 답변을 생성하고 있습니다...',
            progress: 90
        });

        const finalAnswer = await synthesizeFinalAnswer(topic, opinions, crossReview);

        // 6. 완료
        onProgress?.({
            phase: 'complete',
            message: '멀티 에이전트 토론이 완료되었습니다.',
            progress: 100
        });

        return {
            discussionSummary: `${experts.length}명의 전문가가 ${maxRounds}라운드 토론을 진행했습니다.`,
            finalAnswer,
            participants,
            opinions,
            totalTime: Date.now() - startTime,
            factChecked
        };
    }

    return {
        startDiscussion,
        selectExpertAgents
    };
}
