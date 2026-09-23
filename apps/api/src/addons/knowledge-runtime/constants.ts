/**
 * knowledge-runtime 내부 동작 상수 — 운영 정책값(청크·top-K·한도)은 여기가 아니라 `knowledge_profiles` 데이터다.
 * 여기엔 캐시·폴링 주기 같은 구현 파라미터만 둔다(env 로 조정).
 *
 * @module addons/knowledge-runtime/constants
 */
export const KNOWLEDGE_RUNTIME = {
    /** 프로필 캐시 수명(ms) */
    PROFILE_CACHE_TTL_MS: Number(process.env.KNOWLEDGE_PROFILE_CACHE_TTL_MS) || 30_000,
    /** 수집 작업 폴링 주기(ms) */
    JOB_POLL_INTERVAL_MS: Number(process.env.KNOWLEDGE_JOB_POLL_INTERVAL_MS) || 5_000,
    /** 원본 파일 저장 디렉터리(비공개) — 미설정 시 앱 데이터 디렉터리 아래. 호출 시점에 읽는다(테스트·평가가 임시 경로로 바꿀 수 있게) */
    get STORAGE_DIR(): string { return process.env.KNOWLEDGE_STORAGE_DIR || ''; },
    /** 문서 텍스트 추출(파서) 상한(ms) */
    EXTRACT_TIMEOUT_MS: Number(process.env.KNOWLEDGE_EXTRACT_TIMEOUT_MS) || 120_000,
    /** 임베딩 배치 호출 1회 상한(ms) */
    EMBED_TIMEOUT_MS: Number(process.env.KNOWLEDGE_EMBED_TIMEOUT_MS) || 120_000,
    /** 작업 실패 재시도 백오프 기준(ms) — attempts 지수로 늘어난다 */
    JOB_BACKOFF_BASE_MS: Number(process.env.KNOWLEDGE_JOB_BACKOFF_BASE_MS) || 10_000,
    /** 백오프 상한(ms) */
    JOB_BACKOFF_MAX_MS: Number(process.env.KNOWLEDGE_JOB_BACKOFF_MAX_MS) || 300_000,
    /** lease 하트비트 주기 = lease 수명 × 이 비율 */
    JOB_HEARTBEAT_RATIO: Number(process.env.KNOWLEDGE_JOB_HEARTBEAT_RATIO) || 0.4,
    /** tombstoned Space 를 물리 삭제(purge)하기까지 유예(일) — limits.purgeAfterDays 와 별개의 상한이 필요하면 여기서 */
    CLEANUP_BATCH: Number(process.env.KNOWLEDGE_CLEANUP_BATCH) || 50,
} as const;
