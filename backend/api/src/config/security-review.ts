/**
 * ============================================================
 * Security Review Config (P-2)
 * ============================================================
 *
 * 보안 리뷰 도구의 설정값 외부화 (No-Hardcoding L1/L2).
 * 취약점 카테고리·거짓양성 룰셋·신뢰도 임계·크기/온도 — 모두 env override.
 *
 * @module config/security-review
 */

/** 보안 리뷰 운영 파라미터 */
export const SECURITY_REVIEW_CONFIG = {
    /** 도구 활성화 (기본 ON, tier 로 추가 게이트) */
    enabled: process.env.SECURITY_REVIEW_ENABLED !== 'false',
    /** 분석 대상 코드 최대 바이트 (초과 시 거부 — 비용/컨텍스트 보호) */
    maxCodeBytes: Number(process.env.SECURITY_REVIEW_MAX_CODE_BYTES ?? 60_000),
    /** 리포트할 최소 신뢰도 (1-10). 미만은 드롭 — 거짓양성 억제 */
    minConfidence: Number(process.env.SECURITY_REVIEW_MIN_CONFIDENCE ?? 7),
    /** 분석 LLM temperature (결정성 위해 낮게) */
    temperature: Number(process.env.SECURITY_REVIEW_TEMPERATURE ?? 0.1),
    /** 리포트 최대 finding 수 (상한) */
    maxFindings: Number(process.env.SECURITY_REVIEW_MAX_FINDINGS ?? 30),
} as const;

/** 표준 취약점 카테고리 (모델 출력 정규화 기준) */
export const VULN_CATEGORIES = [
    'sql_injection',
    'command_injection',
    'xss',
    'auth_bypass',
    'insecure_crypto',
    'ssrf',
    'path_traversal',
    'hardcoded_secret',
    'insecure_deserialization',
    'sensitive_data_exposure',
    'other',
] as const;

export type VulnCategory = (typeof VULN_CATEGORIES)[number];

/** 심각도 순위 (정렬용, 높을수록 위험) */
export const SEVERITY_RANK: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
};

/**
 * 거짓양성 필터 룰셋 — finding 의 category/title/description 에 매칭되면 드롭.
 * Claude Code security-review 의 false-positive 제외 규칙을 제품 맥락으로 재구성.
 * 노이즈성/저영향/보안아님 항목을 결정론적으로 제거해 신뢰도를 높인다.
 */
export const FALSE_POSITIVE_RULES: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
    { pattern: /denial[- ]of[- ]service|\bdos\b|regex\s*dos|redos|catastrophic backtrack/i, reason: 'DoS/ReDoS 류는 오탐 비중 높음' },
    { pattern: /log (spoof|forg|inject)/i, reason: '로그 스푸핑/포징은 저영향' },
    { pattern: /memory leak|resource leak/i, reason: '안정성 이슈(보안 취약점 아님)' },
    { pattern: /rate.?limit/i, reason: '운영 정책 영역' },
    { pattern: /verbose error|stack ?trace.*(disclos|expos|leak)/i, reason: '저영향 정보노출' },
    { pattern: /missing (security )?header|csp not set/i, reason: '구성 권고(취약점 아님)' },
];
