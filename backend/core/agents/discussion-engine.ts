/**
 * Multi-Agent Discussion Engine
 * 멀티 에이전트 토론 시스템
 * 🆕 개선된 에이전트 선택 (의도 기반)
 */

import { routeToAgent, getAgentById, AGENTS, Agent, AgentSelection, getRelatedAgentsForDiscussion } from './index';

// ========================================
// 타입 정의
// ========================================

export interface DiscussionProgress {
    phase: 'selecting' | 'discussing' | 'reviewing' | 'synthesizing' | 'complete';
    currentAgent?: string;
    agentEmoji?: string;
    message: string;
    progress: number;
    roundNumber?: number;
    totalRounds?: number;
}

export interface AgentOpinion {
    agentId: string;
    agentName: string;
    agentEmoji: string;
    opinion: string;
    confidence: number;
    timestamp: Date;
}

export interface DiscussionResult {
    discussionSummary: string;
    finalAnswer: string;
    participants: string[];
    opinions: AgentOpinion[];
    totalTime: number;
    factChecked?: boolean;
}

export interface DiscussionConfig {
    maxAgents?: number;
    maxRounds?: number;
    enableCrossReview?: boolean;
    enableFactCheck?: boolean;
}

// ========================================
// Discussion Engine
// ========================================

export function createDiscussionEngine(
    generateResponse: (systemPrompt: string, userMessage: string) => Promise<string>,
    config: DiscussionConfig = {},
    onProgress?: (progress: DiscussionProgress) => void
) {
    const {
        maxAgents = 10,  // 🆕 제한 완화: 기본 10명으로 증가 (0 = 무제한)
        maxRounds = 2,
        enableCrossReview = true,
        enableFactCheck = false
    } = config;

    /**
     * 🆕 개선된 전문가 에이전트 선택 (의도 기반)
     */
    async function selectExpertAgents(topic: string): Promise<Agent[]> {
        console.log(`[Discussion] 토론 주제: "${topic.substring(0, 50)}..."`);

        // 🆕 새로운 의도 기반 에이전트 선택 사용 (maxAgents = 0이면 무제한)
        const agentLimit = maxAgents === 0 ? 20 : maxAgents;
        const experts = await getRelatedAgentsForDiscussion(topic, agentLimit);

        console.log(`[Discussion] 선택된 전문가: ${experts.map(e => `${e.emoji} ${e.name}`).join(', ')}`);

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
     */
    async function generateAgentOpinion(
        agent: Agent,
        topic: string,
        previousOpinions: AgentOpinion[]
    ): Promise<AgentOpinion> {
        const systemPrompt = `# ${agent.emoji} ${agent.name}

당신은 **${agent.name}** 전문가입니다.
${agent.description}

## 토론 지침
1. 전문 분야의 관점에서 주제를 분석하세요.
2. 구체적이고 실용적인 의견을 제시하세요.
3. 다른 전문가들의 의견이 있다면 보완하거나 다른 시각을 제공하세요.
4. 응답은 200-400자 내외로 간결하게 작성하세요.`;

        let contextMessage = `## 토론 주제\n${topic}\n\n`;

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

        let contextMessage = `## 토론 주제\n${topic}\n\n## 전문가 의견들\n`;
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

        let contextMessage = `## 질문\n${topic}\n\n## 전문가 의견\n`;
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
                opinions.push(opinion);
            }
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
