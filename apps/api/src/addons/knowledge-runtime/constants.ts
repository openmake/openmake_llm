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
    /** 게시 도중 활성 index 가 바뀌었을 때 새 index 로 다시 임베딩하는 최대 횟수 */
    PUBLISH_INDEX_SWITCH_RETRIES: Number(process.env.KNOWLEDGE_PUBLISH_INDEX_SWITCH_RETRIES) || 2,
} as const;

/**
 * 게시(ready 전환)와 index 전환을 직렬화하는 트랜잭션 advisory lock 키 — 두 트랜잭션이 같은 키를 잡아,
 * 전환 검증과 전환 사이에 새 문서가 ready 가 되거나 옛 index 에만 임베딩된 문서가 전환 뒤 게시되지 않게 한다.
 * 값은 이 용도의 고유 식별자일 뿐이다(pg_advisory_xact_lock 의 bigint 키).
 */
export const INDEX_PUBLISH_LOCK_KEY = 7_041_902_411;
