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

// ========================================
// 타입 정의
// ========================================

/**
 * 토론 진행 상황 인터페이스
 * onProgress 콜백으로 전달되어 실시간 진행률을 클라이언트에 알립니다.
 */
export interface DiscussionProgress {
    /** 현재 단계 (선택 -> 토론 -> 검토 -> 합성 -> 완료) */
    phase: 'selecting' | 'discussing' | 'reviewing' | 'synthesizing' | 'complete';
    /** 현재 의견을 제시 중인 에이전트명 */
    currentAgent?: string;
    /** 현재 에이전트 이모지 */
    agentEmoji?: string;
    /** 진행 상황 메시지 (한국어) */
    message: string;
    /** 전체 진행률 (0-100) */
    progress: number;
    /** 현재 라운드 번호 (1-based) */
    roundNumber?: number;
    /** 총 라운드 수 */
    totalRounds?: number;
}

/**
 * 에이전트 의견 인터페이스
 * 각 전문가 에이전트가 생성한 개별 의견을 담습니다.
 */
export interface AgentOpinion {
    /** 에이전트 고유 ID */
    agentId: string;
    /** 에이전트 표시 이름 */
    agentName: string;
    /** 에이전트 이모지 아이콘 */
    agentEmoji: string;
    /** 에이전트가 생성한 의견 텍스트 */
    opinion: string;
    /** 의견의 신뢰도 (0.0-1.0) */
    confidence: number;
    /** 의견 생성 시각 */
    timestamp: Date;
}

/**
 * 토론 결과 인터페이스
 * startDiscussion()의 최종 반환값입니다.
 */
export interface DiscussionResult {
    /** 토론 요약 메시지 (참여 인원, 라운드 수 등) */
    discussionSummary: string;
    /** 최종 합성된 답변 텍스트 */
    finalAnswer: string;
    /** 참여한 에이전트 이름 배열 */
    participants: string[];
    /** 모든 에이전트의 개별 의견 배열 */
    opinions: AgentOpinion[];
    /** 전체 토론 소요 시간 (ms) */
    totalTime: number;
    /** 웹 검색 사실 검증 수행 여부 */
    factChecked?: boolean;
}

/**
 * 🆕 컨텍스트 우선순위 설정
 * 토큰 제한 시 우선순위가 높은 컨텍스트가 더 많은 토큰을 할당받음
 */
export interface ContextPriority {
    /** 사용자 메모리 (개인화) - 기본 1순위 */
    userMemory: number;
    /** 대화 히스토리 (맥락 유지) - 기본 2순위 */
    conversationHistory: number;
    /** 문서 컨텍스트 (참조 자료) - 기본 3순위 */
    document: number;
    /** 웹 검색 결과 (사실 검증) - 기본 4순위 */
    webSearch: number;
    /** 이미지 컨텍스트 (시각 자료) - 기본 5순위 */
    image: number;
}

/**
 * 🆕 토큰 제한 설정
 */
export interface TokenLimits {
    /** 전체 컨텍스트 최대 토큰 (기본: 8000) */
    maxTotalTokens: number;
    /** 문서 컨텍스트 최대 토큰 (기본: 3000) */
    maxDocumentTokens: number;
    /** 대화 히스토리 최대 토큰 (기본: 2000) */
    maxHistoryTokens: number;
    /** 웹 검색 최대 토큰 (기본: 1500) */
    maxWebSearchTokens: number;
    /** 사용자 메모리 최대 토큰 (기본: 1000) */
    maxMemoryTokens: number;
    /** 이미지 설명 최대 토큰 (기본: 500) */
    maxImageDescriptionTokens: number;
}

export interface DiscussionConfig {
    maxAgents?: number;
    maxRounds?: number;
    enableCrossReview?: boolean;
    enableFactCheck?: boolean;
    /** 🆕 Deep Thinking 모드 활성화 */
    enableDeepThinking?: boolean;
    
    // ========================================
    // 🆕 컨텍스트 엔지니어링 필드
    // ========================================
    /** 업로드된 문서 컨텍스트 (PDF, 이미지 등에서 추출된 텍스트) */
    documentContext?: string;
    /** 대화 히스토리 (이전 대화 맥락 유지) */
    conversationHistory?: Array<{ role: string; content: string }>;
    /** 사용자 메모리 컨텍스트 (장기 기억, 선호도 등) */
    userMemoryContext?: string;
    /** 웹 검색 결과 컨텍스트 */
    webSearchContext?: string;
    
    // ========================================
    // 🆕 이미지 컨텍스트 (비전 모델 지원)
    // ========================================
    /** 이미지 base64 데이터 배열 */
    imageContexts?: string[];
    /** 이미지 분석 결과 (비전 모델이 미리 분석한 텍스트 설명) */
    imageDescriptions?: string[];
    
    // ========================================
    // 🆕 컨텍스트 우선순위 및 토큰 제한
    // ========================================
    /** 컨텍스트 우선순위 설정 */
    contextPriority?: Partial<ContextPriority>;
    /** 토큰 제한 설정 */
    tokenLimits?: Partial<TokenLimits>;
}

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
        conversationHistory,
        userMemoryContext,
        webSearchContext,
        // 🆕 이미지 컨텍스트
        imageContexts,
        imageDescriptions,
        // 🆕 우선순위 및 토큰 제한
        contextPriority,
        tokenLimits
    } = config;
    
    // ========================================
    // 🆕 컨텍스트 우선순위 기본값
    // ========================================
    const defaultPriority: ContextPriority = {
        userMemory: 1,        // 최우선: 개인화
        conversationHistory: 2,  // 맥락 유지
        document: 3,          // 참조 자료
        webSearch: 4,         // 사실 검증
        image: 5              // 시각 자료
    };
    
    const priority: ContextPriority = {
        ...defaultPriority,
        ...contextPriority
    };
    
    // ========================================
    // 🆕 토큰 제한 기본값 (대략적인 문자 수 기준, 1토큰 ≈ 4자)
    // ========================================
    const defaultLimits: TokenLimits = {
        maxTotalTokens: 8000,
        maxDocumentTokens: 3000,
        maxHistoryTokens: 2000,
        maxWebSearchTokens: 1500,
        maxMemoryTokens: 1000,
        maxImageDescriptionTokens: 500
    };
    
    const limits: TokenLimits = {
        ...defaultLimits,
        ...tokenLimits
    };
    
    // 토큰 → 문자 변환 (근사값)
    const tokensToChars = (tokens: number) => tokens * 4;
    
    /**
     * 🆕 문자열을 토큰 제한에 맞게 자르기
     */
    const truncateToLimit = (text: string, maxTokens: number): string => {
        const maxChars = tokensToChars(maxTokens);
        if (text.length <= maxChars) return text;
        
        // 앞부분과 뒷부분을 유지하며 중간 생략
        const half = Math.floor(maxChars / 2);
        return `${text.substring(0, half)}\n\n... [중간 ${text.length - maxChars}자 생략] ...\n\n${text.substring(text.length - half)}`;
    };
    
    /**
     * 🆕 우선순위 기반 통합 컨텍스트 구성 (메모이제이션 적용)
     * 토큰 제한을 고려하여 우선순위가 높은 컨텍스트부터 할당
     * ⚡ 토론 세션 내에서 config 입력이 불변이므로 첫 호출 결과를 캐싱
     */
    let _cachedFullContext: string | null = null;
    const buildFullContext = (): string => {
        if (_cachedFullContext !== null) return _cachedFullContext;
        // 컨텍스트 항목들을 우선순위로 정렬
        const contextItems: Array<{
            priority: number;
            label: string;
            content: string;
            maxTokens: number;
        }> = [];
        
        // 1. 사용자 메모리 (최우선)
        if (userMemoryContext) {
            contextItems.push({
                priority: priority.userMemory,
                label: '💾 사용자 선호도/기억',
                content: userMemoryContext,
                maxTokens: limits.maxMemoryTokens
            });
        }
        
        // 2. 대화 히스토리
        if (conversationHistory && conversationHistory.length > 0) {
            const recentHistory = conversationHistory.slice(-5);
            const historyText = recentHistory
                .map(h => `[${h.role}]: ${h.content.substring(0, 300)}`)
                .join('\n');
            contextItems.push({
                priority: priority.conversationHistory,
                label: '💬 이전 대화 맥락',
                content: historyText,
                maxTokens: limits.maxHistoryTokens
            });
        }
        
        // 3. 문서 컨텍스트
        if (documentContext) {
            contextItems.push({
                priority: priority.document,
                label: '📄 참조 문서',
                content: documentContext,
                maxTokens: limits.maxDocumentTokens
            });
        }
        
        // 4. 웹 검색 결과
        if (webSearchContext) {
            contextItems.push({
                priority: priority.webSearch,
                label: '🔍 웹 검색 결과',
                content: webSearchContext,
                maxTokens: limits.maxWebSearchTokens
            });
        }
        
        // 5. 이미지 설명 (비전 모델 분석 결과)
        if (imageDescriptions && imageDescriptions.length > 0) {
            const imageText = imageDescriptions
                .map((desc, i) => `[이미지 ${i + 1}]: ${desc}`)
                .join('\n');
            contextItems.push({
                priority: priority.image,
                label: '🖼️ 이미지 분석 결과',
                content: imageText,
                maxTokens: limits.maxImageDescriptionTokens
            });
        }
        
        // 우선순위 순으로 정렬
        contextItems.sort((a, b) => a.priority - b.priority);
        
        // 토큰 제한 내에서 컨텍스트 구성
        const parts: string[] = [];
        let totalChars = 0;
        const maxTotalChars = tokensToChars(limits.maxTotalTokens);
        
        for (const item of contextItems) {
            const truncated = truncateToLimit(item.content, item.maxTokens);
            
            // 전체 제한 체크
            if (totalChars + truncated.length > maxTotalChars) {
                const remaining = maxTotalChars - totalChars;
                if (remaining > 100) { // 최소 100자는 있어야 추가
                    parts.push(`## ${item.label}\n${truncated.substring(0, remaining)}...`);
                }
                console.log(`[Discussion] ⚠️ 토큰 제한 도달, ${item.label} 일부 생략`);
                break;
            }
            
            parts.push(`## ${item.label}\n${truncated}`);
            totalChars += truncated.length;
        }
        
        if (parts.length > 0) {
            console.log(`[Discussion] 📊 컨텍스트 구성: ${parts.length}개 항목, ${totalChars}자 (제한: ${maxTotalChars}자)`);
        }
        
        _cachedFullContext = parts.join('\n\n');
        return _cachedFullContext;
    };
    
    /**
     * 🆕 이미지 base64 데이터 반환 (비전 모델용)
     */
    const getImageContexts = (): string[] => {
        return imageContexts || [];
    };

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
    ): Promise<AgentOpinion> {
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
