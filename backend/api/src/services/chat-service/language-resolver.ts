/**
 * ============================================================
 * Language Resolver — 언어 정책 결정 모듈
 * ============================================================
 *
 * 사용자 메시지의 언어를 감지하고 응답 언어 정책을 결정합니다.
 * ChatService.resolveLanguagePolicy 메서드에서 추출되었습니다.
 *
 * @module services/chat-service/language-resolver
 */
import { createLogger } from '../../utils/logger';
import {
    determineLanguagePolicy,
    type SupportedLanguageCode,
    type LanguagePolicyDecision,
} from '../../chat/language-policy';
import { getConfig } from '../../config/env';

const logger = createLogger('LanguageResolver');

/**
 * 사용자 메시지의 언어를 감지하고 응답 언어 정책을 결정합니다.
 *
 * @param message - 사용자 메시지
 * @param userLanguagePreference - 사용자가 명시적으로 설정한 언어 선호
 * @returns 언어 정책 결정 결과 (감지 실패 시 undefined)
 */
export function resolveLanguagePolicy(
    message: string,
    userLanguagePreference?: string,
): LanguagePolicyDecision | undefined {
    const config = getConfig();
    try {
        const policy = determineLanguagePolicy(message, {
            defaultLanguage: config.defaultResponseLanguage,
            enableDynamicResponse: true,
            minConfidenceThreshold: config.languageDetectionMinConfidence,
            shortTextThreshold: 20,
            fallbackLanguage: config.languageFallbackLanguage,
            supportedLanguages: ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi', 'it', 'nl', 'sv', 'da', 'no', 'fi', 'th', 'vi', 'tr']
        }, userLanguagePreference as SupportedLanguageCode | undefined);
        logger.info(`언어 정책 결정: ${policy.resolvedLanguage} (${userLanguagePreference ? '사용자 설정' : '자동 감지'}, 신뢰도: ${policy.detection.confidence.toFixed(2)})`);
        return policy;
    } catch (error) {
        logger.warn('언어 감지 실패, 기본 언어 폴백:', error instanceof Error ? error.message : error);
        // undefined 대신 기본 정책을 반환하여 다운스트림에서 언어 기반 분기가 작동하도록 보장
        const fallbackLang = (config.defaultResponseLanguage || 'ko') as SupportedLanguageCode;
        return {
            requestedLanguage: fallbackLang,
            resolvedLanguage: fallbackLang,
            reason: 'fallback_applied',
            fallbackApplied: true,
            detection: {
                language: fallbackLang,
                confidence: 0,
                method: 'fallback',
                textLength: message.length,
                processedLength: message.length,
            },
        };
    }
}
