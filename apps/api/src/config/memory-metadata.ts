/**
 * 범위 메모리 메타데이터 규칙 (로드맵 4단계, 2026-09-16) — user_memories 의 scope·confidence·
 * sensitivity·expires_at 을 채우는 결정적 규칙. LLM 판단 없음.
 *
 * @module config/memory-metadata
 */
export type MemoryScope = 'user' | 'session' | 'task';
export type MemorySensitivity = 'normal' | 'sensitive';

/** 출처별 기본 신뢰도 — 사용자가 직접 적은 것이 가장 높고, 모델이 감지한 후보가 가장 낮다. */
export const MEMORY_CONFIDENCE_BY_SOURCE: Readonly<Record<'explicit' | 'candidate' | 'batch', number>> = {
    explicit: 1.0,
    batch: 0.8,
    candidate: 0.7,
};

export const MEMORY_METADATA = {
    /** 자동 추출(candidate) 후보의 기본 보존 기간(일). 0 이면 무기한. USER_MEMORY_CANDIDATE_TTL_DAYS. */
    CANDIDATE_TTL_DAYS: parseInt(process.env.USER_MEMORY_CANDIDATE_TTL_DAYS || '90', 10),
    /** 사용자가 직접 지정할 수 있는 최대 TTL(일) — 그 이상은 무기한으로 둔다. */
    MAX_TTL_DAYS: parseInt(process.env.USER_MEMORY_MAX_TTL_DAYS || '3650', 10),
} as const;

/**
 * 민감 패턴 — 자격증명·개인식별 정보. 자동 추출은 매칭 후보를 저장하지 않고, 명시 저장은
 * sensitivity='sensitive' 로 표시만 한다(사용자 의사 존중). USER_MEMORY_SENSITIVE_PATTERNS 로 교체(파이프 구분 정규식).
 */
const DEFAULT_SENSITIVE_PATTERNS: readonly string[] = [
    'password|passwd|비밀번호|패스워드',
    'api[_ -]?key|secret[_ -]?key|access[_ -]?token|bearer\\s+[a-z0-9._-]{16,}',
    'sk-[a-z0-9]{16,}|omk_live_[a-z0-9]{8,}',
    '주민(등록)?번호|\\b\\d{6}-\\d{7}\\b',
    '카드번호|\\b(?:\\d{4}[ -]?){3}\\d{4}\\b',
    '계좌번호|iban|routing number',
];

const SENSITIVE_RES: readonly RegExp[] = (process.env.USER_MEMORY_SENSITIVE_PATTERNS
    ? process.env.USER_MEMORY_SENSITIVE_PATTERNS.split('|||')
    : DEFAULT_SENSITIVE_PATTERNS).map((p) => new RegExp(p, 'i'));

/** PURE: 본문이 민감 패턴에 걸리는가. */
export function isSensitiveMemory(content: string): boolean {
    return SENSITIVE_RES.some((re) => re.test(content));
}

/** PURE: TTL(일) → 만료 시각. 0·음수·NaN 은 무기한(null), 상한 초과도 무기한. */
export function expiresAtFromTtlDays(ttlDays: number | undefined, now: Date = new Date()): Date | null {
    if (ttlDays === undefined || !Number.isFinite(ttlDays) || ttlDays <= 0 || ttlDays > MEMORY_METADATA.MAX_TTL_DAYS) return null;
    return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}
