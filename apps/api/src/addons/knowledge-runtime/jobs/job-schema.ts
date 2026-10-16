/**
 * Knowledge 작업 큐의 저장 스키마 상수·행 타입 — add-on 마이그레이션 004(작업 actor·취소 열, `knowledge_worker_mode`·
 * `knowledge_worker_heartbeats` 표)와 같은 값을 코드가 쓰는 단일 출처다. 값 목록을 바꾸면 마이그레이션의 CHECK 도 함께
 * 바꾼다(`jobs/__tests__/job-schema.test.ts` 가 SQL 과 대조한다).
 *
 * @module addons/knowledge-runtime/jobs/job-schema
 */

/** 작업 상태 — cancelled 는 004 에서 더했다(사용자·관리자 취소) */
export const KNOWLEDGE_JOB_STATES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;
export type KnowledgeJobState = (typeof KNOWLEDGE_JOB_STATES)[number];

/** 작업을 접수시킨 주체 — user(개인 Space)·org(조직 Space)·system(정리·평가). 004 이전 행은 NULL 이며 시스템 작업으로 본다 */
export const JOB_ACTOR_KINDS = ['user', 'org', 'system'] as const;
export type JobActorKind = (typeof JOB_ACTOR_KINDS)[number];

/** 수집 소비자 종류 — inprocess: API 프로세스 안 poller / external: 별도 프로세스(PM2 openmake-knowledge-worker) */
export const KNOWLEDGE_WORKER_MODES = ['inprocess', 'external'] as const;
export type KnowledgeWorkerMode = (typeof KNOWLEDGE_WORKER_MODES)[number];

/** `knowledge_worker_mode` 의 유일한 행(id=1) — claim 권한의 authority */
export interface KnowledgeWorkerModeRow {
    id: number;
    mode: KnowledgeWorkerMode;
    generation: number;
    updated_at: Date;
}

/** `knowledge_worker_heartbeats` 행 — 소비자 프로세스가 주기적으로 갱신한다 */
export interface KnowledgeWorkerHeartbeatRow {
    worker_id: string;
    mode: KnowledgeWorkerMode;
    generation: number;
    last_seen: Date;
    inflight: number;
}

/** 004 가 적용됐는지 보는 `migration_versions.version` 키 — 별도 worker 가 기동 때 확인한다(add-on 네임스페이스 + 파일 번호) */
export const REQUIRED_JOB_SCHEMA_VERSION = 'addon:knowledge-runtime:004';
