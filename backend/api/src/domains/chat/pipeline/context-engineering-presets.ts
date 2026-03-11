/**
 * ============================================================
 * Context Engineering Presets - 프리셋 프롬프트 빌더 함수
 * ============================================================
 *
 * ContextEngineeringBuilder를 사용한 3가지 프리셋 프롬프트 빌더와
 * 동적 메타데이터 생성 함수를 제공합니다.
 *
 * @module chat/context-engineering-presets
 * @see chat/context-engineering - ContextEngineeringBuilder 클래스
 * @see chat/context-engineering-locales - i18n 상수
 */

import { ContextEngineeringBuilder } from './context-engineering';
import { PRESET_CONTENT } from './context-engineering-locales';
import {
    getLanguageTemplate,
    determineLanguagePolicy,
    resolvePromptLocale,
    type SupportedLanguageCode
} from './language-policy';
import type { PromptMetadata } from './context-types';

/**
 * 기본 어시스턴트 프롬프트 빌더
 */
export function buildAssistantPrompt(userLanguage: SupportedLanguageCode = 'en'): string {
    const locale = resolvePromptLocale(userLanguage);
    const content = PRESET_CONTENT[locale].assistant;

    return new ContextEngineeringBuilder()
        .setMetadata({ userLanguage })
        .setRole({
            persona: content.persona,
            expertise: content.expertise,
            behavioralTraits: content.traits,
            toneStyle: 'friendly'
        })
        .addConstraint({
            rule: getLanguageTemplate(userLanguage).languageRule,
            priority: 'critical',
            category: 'language'
        })
        .addConstraint({
            rule: content.uncertainInfo,
            priority: 'high',
            category: 'content'
        })
        .setGoal(content.goal)
        .setOutputFormat({
            type: 'markdown',
            examples: content.examples
        })
        .build();
}

/**
 * 코딩 전문가 프롬프트 빌더
 */
export function buildCoderPrompt(userLanguage: SupportedLanguageCode = 'en'): string {
    const locale = resolvePromptLocale(userLanguage);
    const content = PRESET_CONTENT[locale].coder;

    return new ContextEngineeringBuilder()
        .setMetadata({ userLanguage })
        .setRole({
            persona: content.persona,
            expertise: content.expertise,
            behavioralTraits: content.traits,
            toneStyle: 'professional'
        })
        .addConstraint({
            rule: getLanguageTemplate(userLanguage).languageRule,
            priority: 'critical',
            category: 'language'
        })
        .addConstraint({
            rule: content.completeCode,
            priority: 'critical',
            category: 'content'
        })
        .addConstraint({
            rule: content.securityCode,
            priority: 'high',
            category: 'security'
        })
        .setGoal(content.goal)
        .setOutputFormat({
            type: 'structured',
            examples: content.examples
        })
        .build();
}

/**
 * 추론 전문가 프롬프트 빌더
 */
export function buildReasoningPrompt(userLanguage: SupportedLanguageCode = 'en'): string {
    const locale = resolvePromptLocale(userLanguage);
    const content = PRESET_CONTENT[locale].reasoning;

    return new ContextEngineeringBuilder()
        .setMetadata({ userLanguage })
        .setRole({
            persona: content.persona,
            expertise: content.expertise,
            behavioralTraits: content.traits,
            toneStyle: 'professional'
        })
        .addConstraint({
            rule: getLanguageTemplate(userLanguage).languageRule,
            priority: 'critical',
            category: 'language'
        })
        .addConstraint({
            rule: content.stepByStep,
            priority: 'high',
            category: 'behavior'
        })
        .setGoal(content.goal)
        .setOutputFormat({
            type: 'structured',
            examples: content.examples
        })
        .setThinkingEnabled(true)
        .build();
}

/**
 * 동적 메타데이터 생성 (언어 정책 통합)
 */
export function createDynamicMetadata(
    query: string,
    userPreference?: SupportedLanguageCode
): PromptMetadata {
    const now = new Date();
    const detectedLanguage = determineLanguagePolicy(query, {
        defaultLanguage: userPreference || 'en',
        enableDynamicResponse: true,
        minConfidenceThreshold: 0.7,
        shortTextThreshold: 20,
        fallbackLanguage: 'en',
        supportedLanguages: ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi', 'it', 'nl', 'sv', 'da', 'no', 'fi', 'th', 'vi', 'tr']
    });

    return {
        currentDate: now.toISOString().split('T')[0],
        knowledgeCutoff: '2024-12',
        userLanguage: detectedLanguage.resolvedLanguage,
        requestTimestamp: now.toISOString()
    };
}
