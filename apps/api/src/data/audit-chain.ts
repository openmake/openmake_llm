/**
 * 감사 로그 해시 체인 — 기록(insertAuditRow)과 검증(verifyAuditChainRows·readAuditChain). 마이그레이션 205, 설정 config/audit-chain.
 *
 * 기록: 체인 대상 행이면 같은 트랜잭션 안에서 advisory lock → 마지막 체인 행 조회 → 순번·해시 계산 → INSERT.
 * 잠금은 트랜잭션 범위라, 호출자가 넘긴 연결이 이미 트랜잭션 안이면(대화 공유 감사) 그 커밋까지 체인이 직렬화된다.
 * 체인이 꺼져 있거나 대상이 아닌 행은 종전 INSERT 그대로다.
 *
 * 해시: row_hash = sha256(prev_hash + "\n" + 정규화 내용). 정규화 내용은 키를 정렬한 JSON 이고, details 는 저장되는 모양
 * (JSON 왕복)에서 PII 익명화가 지우는 키(actor)를 뺀 것이다 — 그래서 익명화는 체인을 깨지 않는다.
 *
 * 검증이 알 수 있는 것: 행 내용 변경(content), 행 삭제·체인 컬럼 지우기(gap), 행 바꿔치기(link).
 * 알 수 없는 것: 마지막 행들을 통째로 지운 것(바깥 기준점이 없다), 사용자 삭제로 user_id 가 NULL 이 된 행의 원래 내용
 * (user_erased — FK ON DELETE SET NULL 의 정상 결과와 구분할 수 없어 따로 센다).
 *
 * @module data/audit-chain
 */
import { createHash } from 'crypto';
import { canonicalJson } from '../utils/args-hash';
import {
    AUDIT_CHAIN, AUDIT_CHAIN_EXCLUDED_ACTIONS, AUDIT_CHAIN_EXCLUDED_RESOURCE_TYPES, AUDIT_CHAIN_HASH_EXCLUDED_DETAIL_KEYS,
} from '../config/audit-chain';

/** 감사 행 기록 입력 — audit_logs 컬럼과 같다. */
export interface AuditRowInput {
    action: string;
    userId?: string | number | null;
    resourceType?: string | null;
    resourceId?: string | null;
    details?: Record<string, unknown> | null;
    ipAddress?: string | null;
    userAgent?: string | null;
}

/** 쿼리만 하는 연결 — pg Pool·PoolClient·트랜잭션 클라이언트 공통. */
export interface AuditQueryClient {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

/** PURE: details 를 저장되는 모양(JSON 왕복)으로 만들고 해시에서 빼는 키를 지운다. */
export function normalizeAuditDetails(details: Record<string, unknown> | null | undefined): Record<string, unknown> {
    const stored = JSON.parse(JSON.stringify(details ?? {})) as Record<string, unknown>;
    for (const key of AUDIT_CHAIN_HASH_EXCLUDED_DETAIL_KEYS) delete stored[key];
    return stored;
}

const textOrNull = (v: string | number | null | undefined): string | null => (v === null || v === undefined ? null : String(v));

/** PURE: 해시에 드는 내용 문자열. */
export function auditContentString(c: {
    chainSeq: number | string; timestamp: Date; action: string; userId?: string | number | null;
    resourceType?: string | null; resourceId?: string | null; details?: Record<string, unknown> | null;
}): string {
    return canonicalJson({
        seq: String(c.chainSeq),
        ts: c.timestamp.toISOString(),
        action: c.action,
        user: textOrNull(c.userId),
        rtype: c.resourceType ?? null,
        rid: c.resourceId ?? null,
        details: normalizeAuditDetails(c.details),
    });
}

/** PURE: row_hash. */
export function computeAuditRowHash(prevHash: string, content: string): string {
    return createHash('sha256').update(`${prevHash}\n${content}`).digest('hex');
}

/** PURE: 체인 대상 행인지 — 보존 기간에 지워지는 종류는 넣지 않는다. */
export function isAuditChainable(action: string, resourceType: string | null | undefined): boolean {
    return !AUDIT_CHAIN_EXCLUDED_ACTIONS.includes(action)
        && !(resourceType && AUDIT_CHAIN_EXCLUDED_RESOURCE_TYPES.includes(resourceType));
}

const PLAIN_INSERT_SQL = `INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details, ip_address, user_agent)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`;

const CHAIN_INSERT_SQL = `INSERT INTO audit_logs
    (action, user_id, resource_type, resource_id, details, ip_address, user_agent, timestamp, chain_seq, prev_hash, row_hash)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)`;

/**
 * 감사 행 기록. 체인 대상이면 client 가 **트랜잭션 안**이어야 한다(잠금이 그 트랜잭션 끝까지 유지된다) —
 * 단독 호출은 audit-repository 가 withTransaction 으로 감싼다. 돌려주는 값: 체인 순번(체인 밖이면 null).
 */
export async function insertAuditRow(client: AuditQueryClient, row: AuditRowInput, opts: { chain?: boolean } = {}): Promise<number | null> {
    const params = [
        row.action, textOrNull(row.userId), row.resourceType ?? null, row.resourceId ?? null,
        JSON.stringify(row.details ?? {}), row.ipAddress ?? null, row.userAgent ?? null,
    ];
    const chain = (opts.chain ?? AUDIT_CHAIN.ENABLED) && isAuditChainable(row.action, row.resourceType);
    if (!chain) {
        await client.query(PLAIN_INSERT_SQL, params);
        return null;
    }
    await client.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_CHAIN.LOCK_KEY]);
    const last = (await client.query(
        'SELECT chain_seq, row_hash FROM audit_logs WHERE chain_seq IS NOT NULL ORDER BY chain_seq DESC LIMIT 1',
    )).rows[0] as { chain_seq: string | number; row_hash: string } | undefined;
    const chainSeq = last ? Number(last.chain_seq) + 1 : 1;
    const prevHash = last?.row_hash ?? AUDIT_CHAIN.GENESIS;
    const timestamp = new Date();
    const rowHash = computeAuditRowHash(prevHash, auditContentString({ ...row, chainSeq, timestamp }));
    await client.query(CHAIN_INSERT_SQL, [...params, timestamp, chainSeq, prevHash, rowHash]);
    return chainSeq;
}

/** 검증에 읽는 행 모양 — readAuditChain 의 SELECT 와 같다. */
export interface AuditChainRow {
    id: number | string;
    chain_seq: number | string;
    prev_hash: string | null;
    row_hash: string | null;
    timestamp: Date;
    action: string;
    user_id: string | null;
    resource_type: string | null;
    resource_id: string | null;
    details: Record<string, unknown> | null;
}

export type AuditChainIssueKind = 'gap' | 'link' | 'content' | 'user_erased';

export interface AuditChainVerifyResult {
    /** 검사한 체인 행 수. */
    checked: number;
    firstSeq: number | null;
    lastSeq: number | null;
    /** gap·link·content 가 하나도 없으면 true(user_erased 는 사용자 삭제의 정상 결과일 수 있어 따로 센다). */
    ok: boolean;
    counts: Record<AuditChainIssueKind, number>;
    /** 문제 행(상한 VERIFY_MAX_ISSUES). gap 은 빠진 순번 구간의 첫 순번. */
    issues: Array<{ kind: AuditChainIssueKind; seq: number; id?: number | string; missing?: number }>;
}

/**
 * PURE: 체인 순번 오름차순 행을 검증한다. anchor 는 첫 행 바로 앞 행의 row_hash —
 * 순번 1부터면 genesis, 중간부터 검사하면 직전 행의 해시(없으면 첫 행의 prev_hash 를 믿고 시작한다).
 */
export function verifyAuditChainRows(rows: readonly AuditChainRow[], anchor?: { seq: number; hash: string } | null): AuditChainVerifyResult {
    const counts: Record<AuditChainIssueKind, number> = { gap: 0, link: 0, content: 0, user_erased: 0 };
    const issues: AuditChainVerifyResult['issues'] = [];
    const add = (issue: AuditChainVerifyResult['issues'][number]): void => {
        counts[issue.kind] += 1;
        if (issues.length < AUDIT_CHAIN.VERIFY_MAX_ISSUES) issues.push(issue);
    };
    let prevSeq = anchor?.seq ?? null;
    let prevHash = anchor?.hash ?? null;
    for (const r of rows) {
        const seq = Number(r.chain_seq);
        if (prevSeq === null && seq === 1) { prevSeq = 0; prevHash = AUDIT_CHAIN.GENESIS; }
        if (prevSeq !== null && seq !== prevSeq + 1) add({ kind: 'gap', seq: prevSeq + 1, missing: seq - prevSeq - 1 });
        // 빠진 행이 있으면 앞 해시와 이을 수 없다 — 이 행의 prev_hash 를 새 기준으로 삼는다(gap 으로 이미 셌다).
        else if (prevHash !== null && r.prev_hash !== prevHash) add({ kind: 'link', seq, id: r.id });
        const recomputed = r.prev_hash === null ? null : computeAuditRowHash(r.prev_hash, auditContentString({
            chainSeq: seq, timestamp: r.timestamp, action: r.action, userId: r.user_id,
            resourceType: r.resource_type, resourceId: r.resource_id, details: r.details,
        }));
        if (recomputed !== r.row_hash) add({ kind: r.user_id === null ? 'user_erased' : 'content', seq, id: r.id });
        prevSeq = seq;
        prevHash = r.row_hash;
    }
    return {
        checked: rows.length,
        firstSeq: rows.length ? Number(rows[0].chain_seq) : null,
        lastSeq: rows.length ? Number(rows[rows.length - 1].chain_seq) : null,
        ok: counts.gap === 0 && counts.link === 0 && counts.content === 0,
        counts,
        issues,
    };
}

/** 체인 구간을 읽어 검증한다(fromSeq 부터 limit 행). */
export async function readAndVerifyAuditChain(client: AuditQueryClient, p: { fromSeq?: number; limit?: number } = {}): Promise<AuditChainVerifyResult> {
    const fromSeq = Math.max(1, Math.floor(p.fromSeq ?? 1));
    const limit = Math.min(Math.max(1, Math.floor(p.limit ?? AUDIT_CHAIN.VERIFY_MAX_ROWS)), AUDIT_CHAIN.VERIFY_MAX_ROWS);
    const rows = (await client.query(
        `SELECT id, chain_seq, prev_hash, row_hash, timestamp, action, user_id, resource_type, resource_id, details
           FROM audit_logs WHERE chain_seq >= $1 ORDER BY chain_seq ASC LIMIT $2`,
        [fromSeq, limit],
    )).rows as AuditChainRow[];
    let anchor: { seq: number; hash: string } | null = null;
    if (fromSeq > 1) {
        const prev = (await client.query(
            'SELECT chain_seq, row_hash FROM audit_logs WHERE chain_seq = $1', [fromSeq - 1],
        )).rows[0] as { chain_seq: string | number; row_hash: string | null } | undefined;
        if (prev?.row_hash) anchor = { seq: Number(prev.chain_seq), hash: prev.row_hash };
    }
    return verifyAuditChainRows(rows, anchor);
}
