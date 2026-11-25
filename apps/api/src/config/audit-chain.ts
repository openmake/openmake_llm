/**
 * 감사 로그 해시 체인 설정 (하네스 v1.1 로드맵 P2 "감사 무결성", 마이그레이션 205).
 *
 * 켜면 새 감사 행마다 체인 순번·직전 행 해시·자기 해시를 남기고(data/audit-chain), 관리자 검증 API 가 끊긴 곳을 찾는다.
 * 해시에 드는 내용은 "정상 운영이 바꾸지 않는 값"만이다 — PII 익명화(db-retention 7)가 지우는 ip_address·user_agent·
 * details.actor 는 넣지 않는다. 보존 기간에 행 자체가 지워지는 감사 종류는 처음부터 체인에 넣지 않는다(아래 두 목록 —
 * db-retention·task-retention 의 DELETE 조건과 한 쌍, audit-chain.test.ts 가 어긋남을 잡는다).
 *
 * @module config/audit-chain
 */

const num = (v: string | undefined, d: number): number => {
    const n = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
};

export const AUDIT_CHAIN = {
    /** 기능 게이트 — 기본 꺼짐(opt-in). 꺼져 있으면 체인 컬럼은 NULL 이고 기록 경로는 종전 그대로다. AUDIT_HASH_CHAIN_ENABLED=true */
    ENABLED: process.env.AUDIT_HASH_CHAIN_ENABLED === 'true',
    /** 체인 기록을 직렬화하는 pg advisory lock 키(트랜잭션 범위). 다른 advisory lock 과 겹치지 않는 고정값. AUDIT_HASH_CHAIN_LOCK_KEY */
    LOCK_KEY: num(process.env.AUDIT_HASH_CHAIN_LOCK_KEY, 7_305_205),
    /** 첫 체인 행의 prev_hash. */
    GENESIS: 'genesis',
    /** 검증 1회에 읽는 최대 행 수(관리자 API 의 limit 상한). AUDIT_HASH_CHAIN_VERIFY_MAX_ROWS */
    VERIFY_MAX_ROWS: num(process.env.AUDIT_HASH_CHAIN_VERIFY_MAX_ROWS, 50_000),
    /** 검증 결과에 싣는 끊긴 행 수 상한. */
    VERIFY_MAX_ISSUES: 50,
} as const;

/** 보존 기간에 행이 지워지는 action — 체인에 넣으면 정리될 때마다 체인이 끊긴다(db-retention 7-a·7-b). */
export const AUDIT_CHAIN_EXCLUDED_ACTIONS: readonly string[] = ['login.succeeded', 'security.authz_denied'];

/** 보존 기간에 행이 지워지는 resource_type — 작업 기록 정리가 함께 지운다(task-retention purgeTaskAuditLogs). */
export const AUDIT_CHAIN_EXCLUDED_RESOURCE_TYPES: readonly string[] = ['agent_task'];

/** 해시에서 빼는 details 키 — PII 익명화가 지우는 값(db-retention 7: details - 'actor'). */
export const AUDIT_CHAIN_HASH_EXCLUDED_DETAIL_KEYS: readonly string[] = ['actor'];
