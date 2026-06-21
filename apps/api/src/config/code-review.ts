/**
 * ============================================================
 * Code Review Config (P-1)
 * ============================================================
 *
 * 코드 리뷰 도구(code_review)의 설정값 외부화 (No-Hardcoding).
 * 보안 취약점은 security_review 가 담당 — 여기서는 버그/성능/유지보수/에러처리/재사용에 집중.
 *
 * @module config/code-review
 */

export const CODE_REVIEW_CONFIG = {
    enabled: process.env.CODE_REVIEW_ENABLED !== 'false',
    maxCodeBytes: Number(process.env.CODE_REVIEW_MAX_CODE_BYTES ?? 60_000),
    minConfidence: Number(process.env.CODE_REVIEW_MIN_CONFIDENCE ?? 7),
    temperature: Number(process.env.CODE_REVIEW_TEMPERATURE ?? 0.1),
    maxFindings: Number(process.env.CODE_REVIEW_MAX_FINDINGS ?? 30),
} as const;

/** 리뷰 차원 (dimension 필드 정규화 기준) */
export const REVIEW_DIMENSIONS = [
    'bug', // 정확성/버그
    'performance', // 성능
    'maintainability', // 가독성/유지보수
    'error_handling', // 에러 처리/엣지 케이스
    'reuse', // 중복/단순화/재사용
    'other',
] as const;

export type ReviewDimension = (typeof REVIEW_DIMENSIONS)[number];

/** 심각도 순위 (정렬용) */
export const REVIEW_SEVERITY_RANK: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
};

/**
 * 거짓양성/노이즈 필터 — 순수 스타일·취향 nitpick 을 제거해 신호를 높인다.
 * (Claude Code code-review 의 "altitude/no-slop" 원칙 재구성)
 */
export const REVIEW_FALSE_POSITIVE_RULES: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
    { pattern: /(코드\s*)?스타일|formatting|들여쓰기|indent|세미콜론|semicolon|줄바꿈/i, reason: '포매팅/스타일 취향' },
    { pattern: /naming convention|변수\s*이름|네이밍 (관례|컨벤션)/i, reason: '네이밍 취향' },
    { pattern: /주석을 추가|add (a )?comment|문서화하면 좋|consider documenting/i, reason: '문서화 권고(저영향)' },
    { pattern: /prefer const|use const instead|var 대신/i, reason: '린터가 잡는 사소 항목' },
];
