/**
 * ============================================================
 * Options & History Builder — chat option 조립 + 히스토리 assembly
 * ============================================================
 *
 * ChatService.processMessageInternal 에서 추출.
 *
 * - buildChatOptions: modelSelection + complexity + promptConfig + thinkingMode
 *   → adjustOptionsForModel + 문서 preset + thinking num_predict 보정 결과
 * - assembleHistoryWithSummary: history 자동 요약 + system prompt 조립 +
 *   토큰 예산 부족 시 간결 지시 주입 + user message 추가
 *
 * 양 함수 모두 ChatService state 의존성 0 (pure function + 인자 객체).
 *
 * @module services/chat-service/options-and-history
 */
import { createLogger } from '../../utils/logger';
import { adjustOptionsForModel } from '../../chat/model-selector';
import { GV_SKIP_THRESHOLD } from '../../chat/complexity-assessor';
import { CONCISE_RESPONSE_DIRECTIVE, TOKEN_BUDGETS } from '../../config/llm-parameters';
import { BUDGET_HINTS, CAPACITY } from '../../config/runtime-limits';
import { getGptOssTaskPreset, type ChatMessage, type ModelOptions } from '../../llm';
import type { ModelSelection } from '../../chat/model-selector';
import type { ChatHistoryMessage } from '../chat-service-types';
import type { LanguagePolicyDecision } from '../../chat/language-policy';
import type { RoutingDecisionLog } from '../../chat/routing-logger';

const logger = createLogger('ChatOptionsHistory');

export interface BuildChatOptionsParams {
    modelSelection: ModelSelection;
    promptOptions?: ModelOptions;
    preComplexityScore: number;
    docId?: string;
    thinkingMode?: boolean;
    routingLog: RoutingDecisionLog;
}

/**
 * chat options 조립.
 *
 * 1. adjustOptionsForModel (model + complexity)
 * 2. docId 가 있으면 document preset overlay
 * 3. thinkingMode=true 시 num_predict 최소값 보강 (잘림 방지)
 *
 * 부수효과: thinking 보강 시 routingLog.routeDecision.tokenBudget 업데이트
 */
export function buildChatOptions(p: BuildChatOptionsParams): ModelOptions {
    let chatOptions = adjustOptionsForModel(
        p.modelSelection.model,
        { ...p.modelSelection.options, ...(p.promptOptions || {}) },
        p.modelSelection.queryType,
        p.preComplexityScore,
    );

    if (p.docId) {
        const docPreset = getGptOssTaskPreset('document');
        chatOptions = { ...docPreset, ...chatOptions };
    }

    // Thinking ON 시 num_predict 최소 보장 — Ollama 의 thinking/content 공유 풀에서
    // 작은 cap 으로 thinking 이 토큰을 다 쓰면 message.content 빈 응답 잘림 발생.
    if (p.thinkingMode === true) {
        const minTokens = TOKEN_BUDGETS.THINKING_MIN_TOKENS;
        const current = chatOptions.num_predict;
        if (current === undefined || current === null || (current > 0 && current < minTokens)) {
            logger.info(
                `Thinking 활성 — num_predict 보강: ${current ?? 'undefined'} → ${minTokens}`,
            );
            chatOptions = { ...chatOptions, num_predict: minTokens };
            p.routingLog.routeDecision.tokenBudget = minTokens;
        }
    }

    return chatOptions;
}

type HistoryInput = ChatHistoryMessage | { role: string; content: string; images?: string[] };

export interface AssembleHistoryParams {
    history?: HistoryInput[];
    combinedSystemPrompt: string;
    preComplexityScore: number;
    finalEnhancedMessage: string;
    currentImages: string[];
    recommendedTokenBudget: number;
    languagePolicy?: LanguagePolicyDecision | null;
    model: string;
}

export interface AssembleHistoryResult {
    currentHistory: ChatMessage[];
    /** combinedSystemPrompt + low-budget hint + concise directive 가 합쳐진 최종 system prompt */
    finalSystemPrompt: string;
}

/**
 * 히스토리 assembly + system prompt 조립.
 *
 * 1. preComplexity 가 낮으면 CONCISE_RESPONSE_DIRECTIVE 주입
 * 2. history 가 있으면 자동 요약 시도 (history-summarizer)
 * 3. 토큰 예산 부족 (잔여 < LOW_BUDGET_THRESHOLD) 시 budget hint 주입
 * 4. user message 추가 (이미지 동봉)
 */
export async function assembleHistoryWithSummary(p: AssembleHistoryParams): Promise<AssembleHistoryResult> {
    let combinedSystemPrompt = p.combinedSystemPrompt;

    if (p.preComplexityScore < GV_SKIP_THRESHOLD) {
        combinedSystemPrompt += `\n\n${CONCISE_RESPONSE_DIRECTIVE}`;
    }

    let currentHistory: ChatMessage[];
    if (p.history && p.history.length > 0) {
        let effectiveHistory: Array<{ role: string; content: string; images?: string[] }> = p.history;
        try {
            const { summarizeHistory } = await import('../../chat/history-summarizer');
            const summarized = await summarizeHistory(p.history, p.model);
            if (summarized.wasSummarized) {
                logger.info(`히스토리 요약 적용: ${summarized.originalCount}개 → ${summarized.summarizedCount}개`);
            }
            effectiveHistory = summarized.messages;
        } catch (sumError) {
            logger.warn('히스토리 요약 실패 (원본 유지):', sumError);
        }

        currentHistory = [
            { role: 'system', content: combinedSystemPrompt },
            ...effectiveHistory.map((h) => ({
                role: h.role as ChatMessage['role'],
                content: h.content,
                images: h.images,
            })),
        ];
    } else {
        currentHistory = [{ role: 'system', content: combinedSystemPrompt }];
    }

    // 동적 토큰 예산 프롬프트 — 잔여 예산 부족 시 간결 지시 주입
    if (p.recommendedTokenBudget > 0) {
        const estimatedUsed = currentHistory.reduce((sum, m) => sum + (m.content?.length ?? 0), 0) / CAPACITY.TOKEN_TO_CHAR_RATIO;
        const remaining = 1 - (estimatedUsed / p.recommendedTokenBudget);
        if (remaining < BUDGET_HINTS.LOW_BUDGET_THRESHOLD && remaining > 0) {
            const hint = (p.languagePolicy?.resolvedLanguage === 'ko') ? BUDGET_HINTS.HINT_KO : BUDGET_HINTS.HINT_EN;
            currentHistory[0].content += `\n\n${hint}`;
            logger.info(`💡 토큰 예산 부족 (잔여 ${(remaining * 100).toFixed(0)}%) → 간결 지시 주입`);
        }
    }

    currentHistory.push({
        role: 'user',
        content: p.finalEnhancedMessage,
        ...(p.currentImages.length > 0 && { images: p.currentImages }),
    });

    return {
        currentHistory,
        finalSystemPrompt: currentHistory[0].content || combinedSystemPrompt,
    };
}
