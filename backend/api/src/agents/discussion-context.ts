/**
 * ============================================================
 * Discussion Engine - 컨텍스트 빌더
 * ============================================================
 * 
 * 우선순위 기반 통합 컨텍스트 구성 로직.
 * createContextBuilder 팩토리로 클로저 기반 메모이제이션을 제공합니다.
 * 
 * @module agents/discussion-context
 */

import type { DiscussionConfig, ContextPriority, TokenLimits } from './discussion-types';
import { createLogger } from '../utils/logger';
import { DISCUSSION_TOKEN_BUDGET } from '../config/runtime-limits';
import { resolvePromptLocale } from '../chat/language-policy';
import { DISCUSSION_CONTEXT_LABELS } from './discussion-locales';

const logger = createLogger('Discussion');

// 토큰 → 문자 변환 (근사값)
export const tokensToChars = (tokens: number): number => tokens * 4;

/**
 * 🆕 문자열을 토큰 제한에 맞게 자르기
 * @param middleOmittedFn - 생략 메시지 포맷 함수 (다국어 지원)
 */
export const truncateToLimit = (
    text: string,
    maxTokens: number,
    middleOmittedFn?: (charCount: number) => string,
): string => {
    const maxChars = tokensToChars(maxTokens);
    if (text.length <= maxChars) return text;

    // 앞부분과 뒷부분을 유지하며 중간 생략
    const half = Math.floor(maxChars / 2);
    const omitted = text.length - maxChars;
    const omitMsg = middleOmittedFn ? middleOmittedFn(omitted) : `... [${omitted} chars omitted] ...`;
    return `${text.substring(0, half)}\n\n${omitMsg}\n\n${text.substring(text.length - half)}`;
};

/**
 * 컨텍스트 빌더 팩토리 함수
 * 
 * DiscussionConfig를 받아 우선순위 기반 컨텍스트 구성 객체를 반환합니다.
 * 내부적으로 메모이제이션(_cachedFullContext)을 사용하여 동일 세션 내 반복 호출을 최적화합니다.
 * 
 * @param config - 토론 설정 (컨텍스트 엔지니어링 필드 포함)
 * @returns buildFullContext(), getImageContexts() 메서드를 가진 컨텍스트 빌더 객체
 */
export function createContextBuilder(config: DiscussionConfig): {
    buildFullContext(): string;
    getImageContexts(): string[];
} {
    const {
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
        tokenLimits,
        userLanguage,
    } = config;

    // 다국어 레이블 resolve
    const locale = resolvePromptLocale(userLanguage || 'en');
    const contextLabels = DISCUSSION_CONTEXT_LABELS[locale];

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
        maxTotalTokens: DISCUSSION_TOKEN_BUDGET.COMPACT.maxTotalTokens,
        maxDocumentTokens: DISCUSSION_TOKEN_BUDGET.COMPACT.maxDocumentTokens,
        maxHistoryTokens: DISCUSSION_TOKEN_BUDGET.COMPACT.maxHistoryTokens,
        maxWebSearchTokens: DISCUSSION_TOKEN_BUDGET.COMPACT.maxWebSearchTokens,
        maxMemoryTokens: DISCUSSION_TOKEN_BUDGET.COMPACT.maxMemoryTokens,
        maxImageDescriptionTokens: 500
    };
    
    const limits: TokenLimits = {
        ...defaultLimits,
        ...tokenLimits
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
                label: contextLabels.userMemory,
                content: userMemoryContext,
                maxTokens: limits.maxMemoryTokens
            });
        }

        // 2. 대화 히스토리
        if (conversationHistory && conversationHistory.length > 0) {
            const recentHistory = conversationHistory.slice(-5);
            const historyText = recentHistory
                .map(h => `${h.role}: ${h.content.substring(0, 300)}`)
                .join('\n');
            contextItems.push({
                priority: priority.conversationHistory,
                label: contextLabels.conversationHistory,
                content: historyText,
                maxTokens: limits.maxHistoryTokens
            });
        }

        // 3. 문서 컨텍스트
        if (documentContext) {
            contextItems.push({
                priority: priority.document,
                label: contextLabels.document,
                content: documentContext,
                maxTokens: limits.maxDocumentTokens
            });
        }

        // 4. 웹 검색 결과
        if (webSearchContext) {
            contextItems.push({
                priority: priority.webSearch,
                label: contextLabels.webSearch,
                content: webSearchContext,
                maxTokens: limits.maxWebSearchTokens
            });
        }

        // 5. 이미지 설명 (비전 모델 분석 결과)
        if (imageDescriptions && imageDescriptions.length > 0) {
            const imageText = imageDescriptions
                .map((desc, i) => `${contextLabels.imageItem(i + 1)}: ${desc}`)
                .join('\n');
            contextItems.push({
                priority: priority.image,
                label: contextLabels.imageAnalysis,
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
            const truncated = truncateToLimit(item.content, item.maxTokens, contextLabels.middleOmitted);
            
            // 전체 제한 체크
            if (totalChars + truncated.length > maxTotalChars) {
                const remaining = maxTotalChars - totalChars;
                if (remaining > 100) { // 최소 100자는 있어야 추가
                    parts.push(`## ${item.label}\n${truncated.substring(0, remaining)}...`);
                }
                logger.info(`⚠️ 토큰 제한 도달, ${item.label} 일부 생략`);
                break;
            }
            
            parts.push(`## ${item.label}\n${truncated}`);
            totalChars += truncated.length;
        }
        
        if (parts.length > 0) {
            logger.info(`📊 컨텍스트 구성: ${parts.length}개 항목, ${totalChars}자 (제한: ${maxTotalChars}자)`);
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

    return {
        buildFullContext,
        getImageContexts
    };
}
