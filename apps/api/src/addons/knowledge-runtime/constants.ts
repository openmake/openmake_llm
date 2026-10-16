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
    /** claim 뒤 실행 판정이 보류(add-on 꺼짐·상태 확인 불가)면 다시 집기까지 기다리는 시간(ms) — attempts 는 되돌린다 */
    JOB_ADMISSION_DEFER_MS: Number(process.env.KNOWLEDGE_JOB_ADMISSION_DEFER_MS) || 30_000,
    /** 소비자 heartbeat 행 갱신 주기(ms) — API inprocess poller·별도 worker 둘 다 */
    WORKER_HEARTBEAT_MS: Number(process.env.KNOWLEDGE_WORKER_HEARTBEAT_MS) || 5_000,
    /** 이보다 오래 갱신되지 않은 heartbeat 행은 갱신 때 지운다(ms) — 프로세스가 재시작될 때마다 worker_id 가 바뀐다 */
    WORKER_HEARTBEAT_RETENTION_MS: Number(process.env.KNOWLEDGE_WORKER_HEARTBEAT_RETENTION_MS) || 86_400_000,
    /** 별도 worker 정지 때 진행 중 작업을 기다리는 상한(ms) — 넘으면 lease 를 반납하고 멈춘다 */
    WORKER_DRAIN_TIMEOUT_MS: Number(process.env.KNOWLEDGE_WORKER_DRAIN_TIMEOUT_MS) || 20_000,
    /** 별도 worker 종료 전체 상한(ms) — drain + DB 풀 종료. PM2 kill_timeout(30초)보다 짧아야 한다 */
    WORKER_SHUTDOWN_TIMEOUT_MS: Number(process.env.KNOWLEDGE_WORKER_SHUTDOWN_TIMEOUT_MS) || 25_000,
    /** 별도 worker 가 기동 때 add-on 마이그레이션(004)을 기다리는 상한(ms) — API 가 먼저 떠서 적용한다 */
    WORKER_SCHEMA_WAIT_MS: Number(process.env.KNOWLEDGE_WORKER_SCHEMA_WAIT_MS) || 60_000,
    /** 위 대기 중 다시 확인하는 주기(ms) */
    WORKER_SCHEMA_POLL_MS: Number(process.env.KNOWLEDGE_WORKER_SCHEMA_POLL_MS) || 2_000,
    /** /api/health 의 inflight 합산에 넣는 heartbeat 나이 상한(ms) — heartbeat 주기의 세 배 */
    WORKER_HEARTBEAT_STALE_MS: Number(process.env.KNOWLEDGE_WORKER_HEARTBEAT_STALE_MS) || 15_000,
} as const;

/**
 * 게시(ready 전환)와 index 전환을 직렬화하는 트랜잭션 advisory lock 키 — 두 트랜잭션이 같은 키를 잡아,
 * 전환 검증과 전환 사이에 새 문서가 ready 가 되거나 옛 index 에만 임베딩된 문서가 전환 뒤 게시되지 않게 한다.
 * 값은 이 용도의 고유 식별자일 뿐이다(pg_advisory_xact_lock 의 bigint 키).
 */
export const INDEX_PUBLISH_LOCK_KEY = 7_041_902_411;

/** 이 add-on 의 id — 실행 판정·상태 revision 조회 키(매니페스트 `id` 와 같아야 한다) */
export const KNOWLEDGE_ADDON_ID = 'knowledge-runtime';
