/**
 * ============================================================
 * Discussion Router — 토론 모드 동적 활성화 결정
 * ============================================================
 *
 * 사용자 명시 모드와 프로파일/복잡도 기반 자동 결정을 결합하여
 * 멀티 에이전트 토론 활성화 여부를 판단합니다.
 *
 * @module chat/discussion-router
 */
import { assessComplexity } from './complexity-assessor';
import {
    DISCUSSION_AUTO_THRESHOLD,
    DISCUSSION_AUTO_ENABLED,
    DISCUSSION_AUTO_MODE_THRESHOLD,
    DISCUSSION_AUTO_MODE_ENABLED,
} from '../config/routing-config';
import { DEFAULT_AUTO_MODEL } from '../config/constants';
import { createLogger } from '../utils/logger';
import type { ExecutionPlan } from './profile-resolver';

const logger = createLogger('DiscussionRouter');

export interface DiscussionDecisionParams {
    /** 클라이언트가 명시한 토론 모드 (true=강제 활성화, false=강제 비활성화, undefined=자동 결정) */
    explicitMode: boolean | undefined;
    /** 프로파일 기반 실행 계획 — useDiscussion=true면 자동 활성화 후보 */
    executionPlan: ExecutionPlan | undefined;
    /** 사용자 메시지 */
    message: string;
    /** 이미지 첨부 여부 */
    hasImages: boolean;
    /** 문서 첨부 여부 */
    hasDocuments: boolean;
    /** 대화 이력 길이 */
    historyLength: number;
}

export interface DiscussionDecision {
    /** 토론 활성화 여부 */
    activate: boolean;
    /** 자동 결정인지 (true=시스템 자동, false=사용자 명시 또는 미적용) */
    autoActivated: boolean;
    /** 자동 결정 시 복잡도 점수 (사용자 명시인 경우 undefined) */
    complexityScore?: number;
    /** 결정 근거 (디버그/관측성용) */
    reason: string;
}

/**
 * Auto 프로파일 자동 토론 활성화 알림 메시지 (다국어)
 * 마크다운 인용 블록으로 본문과 시각적으로 분리.
 * Pro 프로파일은 사용자가 의도적으로 선택했으므로 알림 불필요 (Gemini 권고).
 */
const AUTO_DISCUSSION_NOTICE: Record<string, string> = {
    ko: '> **자동 토론 모드 안내**: 복잡한 질문으로 판단되어 멀티 에이전트 토론 모드를 자동 활성화했습니다. 응답 시간이 일반보다 길어질 수 있습니다.\n\n',
    en: '> **Auto Discussion Mode**: This question was identified as complex, so multi-agent discussion mode has been auto-activated. Response time may be longer than usual.\n\n',
    ja: '> **自動ディスカッションモード**: 複雑な質問と判断され、マルチエージェントディスカッションモードが自動的に有効化されました。応答時間が通常より長くなる場合があります。\n\n',
    zh: '> **自动讨论模式**: 该问题被识别为复杂问题，已自动启用多代理讨论模式。响应时间可能比平常更长。\n\n',
    es: '> **Modo de Discusión Automática**: Esta pregunta se identificó como compleja, por lo que se ha activado automáticamente el modo de discusión de múltiples agentes. El tiempo de respuesta puede ser más largo de lo habitual.\n\n',
    de: '> **Automatischer Diskussionsmodus**: Diese Frage wurde als komplex erkannt; der Multi-Agenten-Diskussionsmodus wurde automatisch aktiviert. Die Antwortzeit kann länger als üblich sein.\n\n',
    fr: '> **Mode de Discussion Automatique** : Cette question a été identifiée comme complexe ; le mode de discussion multi-agents a été activé automatiquement. Le temps de réponse peut être plus long que d\'habitude.\n\n',
};

/**
 * 자동 토론 활성화 알림 메시지를 반환합니다.
 * Auto 프로파일에서 시스템이 자동 활성화한 경우에만 표시 권장.
 *
 * @param decision decideDiscussionActivation의 반환값
 * @param language 사용자 언어 코드 (ko, en, ja 등)
 * @returns 알림 메시지 (해당 케이스가 아니면 빈 문자열)
 */
export function getAutoDiscussionNotice(decision: DiscussionDecision, language: string = 'en'): string {
    if (!decision.autoActivated) return '';
    // Auto 프로파일 모드에서만 알림 (Pro 프로파일은 사용자 의도)
    if (!decision.reason.startsWith('auto-complexity-auto:')) return '';
    return AUTO_DISCUSSION_NOTICE[language] ?? AUTO_DISCUSSION_NOTICE.en;
}

/**
 * 토론 모드 활성화 여부를 결정합니다.
 *
 * 우선순위:
 * 1. explicitMode === true → 사용자 명시 강제 활성화
 * 2. explicitMode === false → 사용자 명시 거부
 * 3. DISCUSSION_AUTO_ENABLED=false → 자동 결정 비활성
 * 4. executionPlan.useDiscussion=true (Pro) → 일반 임계값(0.7)으로 평가
 * 5. Auto 프로파일 + DISCUSSION_AUTO_MODE_ENABLED=true → 보수 임계값(0.9)으로 평가
 * 6. 그 외 → 비활성화
 *
 * 복잡도 평가는 modelSelection 없이 간이 평가('chat' 가정)로 수행하여
 * 보수적으로 동작합니다 (= 토론을 적게 발동).
 */
export function decideDiscussionActivation(params: DiscussionDecisionParams): DiscussionDecision {
    const { explicitMode, executionPlan, message, hasImages, hasDocuments, historyLength } = params;

    if (explicitMode === true) {
        return { activate: true, autoActivated: false, reason: 'explicit-true' };
    }
    if (explicitMode === false) {
        return { activate: false, autoActivated: false, reason: 'explicit-false' };
    }
    if (!DISCUSSION_AUTO_ENABLED) {
        return { activate: false, autoActivated: false, reason: 'auto-disabled' };
    }

    // 프로파일 분기: Pro(useDiscussion=true) vs Auto vs 그 외
    const profileName = executionPlan?.requestedModel || 'unknown';
    const isAutoProfile = profileName === DEFAULT_AUTO_MODEL;
    const isProDiscussionProfile = !!executionPlan?.useDiscussion;

    let threshold: number;
    let mode: 'pro' | 'auto';
    if (isProDiscussionProfile) {
        threshold = DISCUSSION_AUTO_THRESHOLD;
        mode = 'pro';
    } else if (isAutoProfile && DISCUSSION_AUTO_MODE_ENABLED) {
        threshold = DISCUSSION_AUTO_MODE_THRESHOLD;
        mode = 'auto';
    } else {
        return { activate: false, autoActivated: false, reason: 'profile-no-discussion' };
    }

    const complexity = assessComplexity({
        query: message,
        classification: { type: 'chat', confidence: 0.5, matchedPatterns: [] },
        hasImages,
        hasDocuments,
        historyLength,
    });

    const activate = complexity.score >= threshold;

    if (activate) {
        logger.info(
            `토론 자동 활성화: profile=${profileName}, mode=${mode}, ` +
            `complexity=${complexity.score.toFixed(2)} >= threshold=${threshold}, ` +
            `signals=[${complexity.signals.join(', ')}]`
        );
        return {
            activate: true,
            autoActivated: true,
            complexityScore: complexity.score,
            reason: `auto-complexity-${mode}:${complexity.score.toFixed(2)}`,
        };
    }

    logger.debug(
        `토론 자동 활성화 보류: mode=${mode}, complexity=${complexity.score.toFixed(2)} < threshold=${threshold}`
    );
    return {
        activate: false,
        autoActivated: false,
        complexityScore: complexity.score,
        reason: `complexity-below-threshold-${mode}:${complexity.score.toFixed(2)}`,
    };
}
