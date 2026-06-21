/**
 * ============================================================
 * Fast-Path Detector — 명백한 단답형 질문 감지
 * ============================================================
 *
 * thinking 모드를 강제 비활성화해도 안전한 질문을 식별합니다.
 * 인사, 감사, 시간/날짜 조회, 메타 질문 등 추론이 명백히 불필요한 경우만 매칭.
 *
 * 원칙:
 *   - False Positive 0% 우선 (의심스러우면 매칭 안 함)
 *   - False Negative 허용 (놓치면 thinking 그대로 진행 — 안전)
 *   - 모든 매칭은 로그로 추적 가능
 *
 * @module chat/fast-path-detector
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('FastPathDetector');

/**
 * Fast-path 패턴 정의.
 * 각 패턴은 매우 좁은 범위 — 추론 깊이가 명백히 불필요한 경우만.
 */
const FAST_PATH_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
    // ── 인사 ──
    // "안녕", "안녕하세요", "안녕하십니까" 등 정중체 변형 허용
    { pattern: /^\s*(안녕(하세요|하십니까)?|반가워(요)?|반갑(습니다|네요)|hi|hello|hey|좋은\s*(아침|오후|저녁|밤))[\s!.?~]*$/i, reason: 'greeting' },
    { pattern: /^\s*(잘\s*있었어|잘\s*지냈어|how\s+are\s+you|how\s+r\s+u)[\s!.?~]*$/i, reason: 'greeting_status' },

    // ── 감사 / 작별 ──
    { pattern: /^\s*(고마워요?|감사해요?|감사합니다|thank\s*you|thanks|thx)[\s!.?~]*$/i, reason: 'thanks' },
    { pattern: /^\s*(잘\s*가|안녕히\s*(가세요|계세요)|bye|goodbye|see\s+you)[\s!.?~]*$/i, reason: 'farewell' },

    // ── 짧은 긍정/부정 응답 ──
    { pattern: /^\s*(네|예|응|어|yeah|yes|ok|okay|sure)[\s!.?~]*$/i, reason: 'affirmation' },
    { pattern: /^\s*(아니요?|아뇨|nope?|no)[\s!.?~]*$/i, reason: 'negation' },

    // ── 메타 질문 (모델 자체에 대한 짧은 질문) ──
    { pattern: /^\s*(누구야|넌\s*뭐야|너는\s*뭐야|who\s+are\s+you|what\s+are\s+you)[\s!.?~]*$/i, reason: 'meta_identity' },
    { pattern: /^\s*(이름이?\s*뭐야|네\s*이름|what.s\s+your\s+name)[\s!.?~]*$/i, reason: 'meta_name' },

    // ── 단순 시간/날짜 (정확한 답을 원하는 사실 조회) ──
    // "지금 몇 시", "지금 몇 시야", "지금 몇 시예요", "지금 몇 시인가요" 등 한국어 어미 허용
    { pattern: /^\s*(지금\s*몇\s*시(야|예요|에요|입니까|인가요|니|니까)?|현재\s*시간(은|이|이야|이에요|입니까)?|what\s+time\s+is\s+it)[\s!.?~]*$/i, reason: 'time_query' },
    { pattern: /^\s*(오늘\s*(며칠|날짜|요일)(이야|이에요|입니까|인가요)?|today.s\s+date)[\s!.?~]*$/i, reason: 'date_query' },
];

/** 최소 의미 길이: 1자 미만(빈/공백)은 검사 대상 외. "네"/"yes" 같은 1자 응답은 매칭 허용 */
const MIN_MEANINGFUL_LENGTH = 1;

/** 최대 fast-path 길이: 50자 초과는 검사 대상 외 (긴 메시지는 thinking 가능성 ↑) */
const MAX_FAST_PATH_LENGTH = 50;

/**
 * Fast-path 매칭 결과
 */
export interface FastPathMatch {
    /** 매칭 여부 */
    matched: boolean;
    /** 매칭된 패턴의 reason 식별자 (matched=false면 undefined) */
    reason?: string;
}

/**
 * 주어진 쿼리가 fast-path에 해당하는지 검사합니다.
 *
 * @param query 사용자 입력 텍스트
 * @returns 매칭 결과
 */
export function detectFastPath(query: string): FastPathMatch {
    if (!query || typeof query !== 'string') return { matched: false };

    const trimmed = query.trim();
    if (trimmed.length < MIN_MEANINGFUL_LENGTH) return { matched: false };
    if (trimmed.length > MAX_FAST_PATH_LENGTH) return { matched: false };

    for (const { pattern, reason } of FAST_PATH_PATTERNS) {
        if (pattern.test(trimmed)) {
            logger.info(`Fast-path 매칭: reason=${reason}, query="${trimmed.slice(0, 30)}"`);
            return { matched: true, reason };
        }
    }

    return { matched: false };
}
