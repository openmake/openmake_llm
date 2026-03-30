/**
 * ============================================================
 * Feedback Cache Corrector - 피드백 기반 분류 캐시 교정
 * ============================================================
 *
 * 사용자 피드백(thumbs_up/down)에 따라 분류 캐시를 교정합니다.
 * - thumbs_down: 캐시 항목 무효화 → 다음 동일 쿼리에서 LLM 재분류 강제
 * - thumbs_up: 캐시 신뢰도 부스트 → 캐시 히트 시 더 확신 있는 라우팅
 *
 * Harness Engineering 원칙: Correct — 사용자 피드백 루프로 분류 캐시 품질 개선
 *
 * @module chat/feedback-cache-corrector
 * @see chat/llm-classifier.ts - clearClassificationCache, _setSemanticCacheForTest
 * @see config/runtime-limits.ts - FEEDBACK_CACHE_CORRECTION config
 */
import { createLogger } from '../utils/logger';
import { FEEDBACK_CACHE_CORRECTION } from '../config/runtime-limits';

const logger = createLogger('FeedbackCacheCorrector');

/** 캐시 교정 결과 */
export interface CacheCorrectionResult {
    /** 교정 수행 여부 */
    corrected: boolean;
    /** 수행된 액션 */
    action: 'invalidated' | 'boosted' | 'skipped';
    /** 상세 메시지 */
    message: string;
}

/** 교정 통계 (모니터링용) */
const correctionStats = {
    invalidations: 0,
    boosts: 0,
    skipped: 0,
    rateLimited: 0,
};

// ── P4-B: 피드백 노이즈 보호 — 동일 쿼리 과다 교정 방지 ──
const correctionHistory = new Map<string, number[]>();

/**
 * 동일 쿼리에 대한 교정 횟수가 제한을 초과하는지 확인합니다.
 * 슬라이딩 윈도우 방식으로 최근 N시간 내 교정 횟수를 추적합니다.
 */
function isRateLimited(query: string): boolean {
    const maxCorrections = FEEDBACK_CACHE_CORRECTION.MAX_CORRECTIONS_PER_QUERY;
    const windowMs = FEEDBACK_CACHE_CORRECTION.CORRECTION_WINDOW_MS;
    const key = query.trim().toLowerCase().substring(0, 100);
    const now = Date.now();

    const timestamps = correctionHistory.get(key) ?? [];
    // 윈도우 밖의 기록 제거
    const recent = timestamps.filter(t => now - t < windowMs);

    if (recent.length >= maxCorrections) {
        correctionStats.rateLimited++;
        logger.debug(`피드백 교정 레이트 리밋: "${key.substring(0, 30)}..." (${recent.length}/${maxCorrections} in window)`);
        return true;
    }

    recent.push(now);
    correctionHistory.set(key, recent);
    return false;
}

/**
 * thumbs_down 피드백 시 분류 캐시를 교정합니다.
 *
 * INVALIDATE_ON_NEGATIVE=true: 캐시에서 해당 쿼리를 제거하여
 * 다음 동일 쿼리에서 LLM이 다시 분류하도록 강제합니다.
 *
 * @param query - 원본 쿼리 (캐시 키)
 * @param queryType - 기존 분류 결과
 */
export async function correctOnNegativeFeedback(
    query: string | undefined,
    queryType: string | undefined,
): Promise<CacheCorrectionResult> {
    if (!FEEDBACK_CACHE_CORRECTION.ENABLED) {
        return { corrected: false, action: 'skipped', message: 'FEEDBACK_CACHE_CORRECTION 비활성화' };
    }

    if (!query) {
        correctionStats.skipped++;
        return { corrected: false, action: 'skipped', message: '쿼리 정보 없음' };
    }

    if (!FEEDBACK_CACHE_CORRECTION.INVALIDATE_ON_NEGATIVE) {
        correctionStats.skipped++;
        return { corrected: false, action: 'skipped', message: 'INVALIDATE_ON_NEGATIVE 비활성화' };
    }

    // P4-B: 노이즈 보호 — 동일 쿼리 과다 교정 방지
    if (isRateLimited(query)) {
        return { corrected: false, action: 'skipped', message: '교정 횟수 제한 초과 (rate-limited)' };
    }

    try {
        // 동적 import로 순환 의존 방지
        const { invalidateCacheEntry } = await import('./llm-classifier');
        const deleted = invalidateCacheEntry(query);

        logger.info(
            `👎 부정 피드백 캐시 교정: query="${query.substring(0, 50)}..." type=${queryType} deleted=${deleted}`,
            FEEDBACK_CACHE_CORRECTION.INCLUDE_IN_METRICS
                ? { feedbackCorrection: { action: 'invalidated', query: query.substring(0, 100), queryType, deleted } }
                : undefined,
        );

        correctionStats.invalidations++;

        return {
            corrected: true,
            action: 'invalidated',
            message: `부정 피드백 캐시 무효화: "${query.substring(0, 50)}..." (type=${queryType}, deleted=${deleted})`,
        };
    } catch (err) {
        logger.debug(`피드백 캐시 교정 실패 (무시): ${err instanceof Error ? err.message : err}`);
        correctionStats.skipped++;
        return { corrected: false, action: 'skipped', message: '캐시 교정 중 오류' };
    }
}

/**
 * thumbs_up 피드백 시 분류 캐시 신뢰도를 부스트합니다.
 *
 * 동일 쿼리의 캐시 항목이 존재하면 신뢰도를 POSITIVE_BOOST만큼 증가시켜
 * 향후 캐시 히트 시 더 확신 있는 라우팅이 되도록 합니다.
 *
 * @param query - 원본 쿼리 (캐시 키)
 * @param queryType - 분류 결과
 * @param currentConfidence - 현재 신뢰도
 */
export async function boostOnPositiveFeedback(
    query: string | undefined,
    queryType: string | undefined,
    currentConfidence?: number,
): Promise<CacheCorrectionResult> {
    if (!FEEDBACK_CACHE_CORRECTION.ENABLED) {
        return { corrected: false, action: 'skipped', message: 'FEEDBACK_CACHE_CORRECTION 비활성화' };
    }

    if (!query || !queryType) {
        correctionStats.skipped++;
        return { corrected: false, action: 'skipped', message: '쿼리/타입 정보 없음' };
    }

    // P4-B: 노이즈 보호 — 동일 쿼리 과다 교정 방지
    if (isRateLimited(query)) {
        return { corrected: false, action: 'skipped', message: '교정 횟수 제한 초과 (rate-limited)' };
    }

    try {
        const { updateCacheConfidence } = await import('./llm-classifier');
        const boost = FEEDBACK_CACHE_CORRECTION.POSITIVE_BOOST;
        const newConfidence = Math.min(1.0, (currentConfidence ?? 0.7) + boost);

        updateCacheConfidence(query, queryType, newConfidence);

        logger.info(
            `👍 긍정 피드백 캐시 부스트: query="${query.substring(0, 50)}..." type=${queryType} confidence=${currentConfidence?.toFixed(2) ?? '?'}→${newConfidence.toFixed(2)}`,
            FEEDBACK_CACHE_CORRECTION.INCLUDE_IN_METRICS
                ? { feedbackCorrection: { action: 'boost', query: query.substring(0, 100), queryType, boost, newConfidence } }
                : undefined,
        );

        correctionStats.boosts++;

        return {
            corrected: true,
            action: 'boosted',
            message: `긍정 피드백 부스트: "${query.substring(0, 50)}..." (${queryType}, +${boost})`,
        };
    } catch (err) {
        logger.debug(`피드백 캐시 부스트 실패 (무시): ${err instanceof Error ? err.message : err}`);
        correctionStats.skipped++;
        return { corrected: false, action: 'skipped', message: '캐시 부스트 중 오류' };
    }
}

/** 교정 통계를 반환합니다 (모니터링용) */
export function getCorrectionStats(): { invalidations: number; boosts: number; skipped: number; rateLimited: number } {
    return { ...correctionStats };
}
