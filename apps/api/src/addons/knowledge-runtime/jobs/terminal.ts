/**
 * 집은 작업의 마감 — 실행하지 않고 되돌리거나(보류) 끝내는(failed·cancelled) 쓰기. 모두 claim 이 준 token·owner 의
 * running 행에만 닿는다(fence) — 이미 다른 실행자가 다시 집은 행은 건드리지 않는다.
 * 수집 작업을 끝낼 때는 문서 버전·문서도 같은 트랜잭션에서 failed 로 둔다(이미 ready 인 버전·문서는 그대로).
 *
 * @module addons/knowledge-runtime/jobs/terminal
 */
import type { PoolClient } from 'pg';
import { kdb, inTransaction } from '../db';
import { KNOWLEDGE_RUNTIME } from '../constants';
import type { FailureCode } from '../ingestion/errors';

/** claim 이 준 행의 신원 — 마감 쓰기의 fence 조건 */
export interface ClaimedRef {
    id: string;
    fencingToken: string;
    owner: string;
}

/**
 * 실행 보류 — queued 로 되돌리고 claim 이 올린 attempts 를 하나 되돌린다(보류는 시도가 아니다).
 * `JOB_ADMISSION_DEFER_MS` 뒤에 다시 집힌다. 되돌렸으면 true
 */
export async function deferClaimedJob(job: ClaimedRef, reason: string): Promise<boolean> {
    const r = await kdb().query(
        `UPDATE knowledge_ingestion_jobs
            SET state = 'queued', lease_owner = NULL, lease_expires_at = NULL, attempts = GREATEST(attempts - 1, 0),
                last_error = $4, run_after = NOW() + ($5::bigint * INTERVAL '1 millisecond'), updated_at = NOW()
          WHERE id = $1 AND fencing_token = $2 AND lease_owner = $3 AND state = 'running'`,
        [job.id, job.fencingToken, job.owner, reason.slice(0, 2000), KNOWLEDGE_RUNTIME.JOB_ADMISSION_DEFER_MS],
    );
    return (r.rowCount ?? 0) > 0;
}

export interface TerminalInput {
    jobId: string;
    /** fencing_token(BIGINT 문자열 그대로) */
    token: string;
    owner: string;
    state: 'failed' | 'cancelled';
    lastError: string;
    /** 수집 작업이면 문서 버전에 남길 실패 코드 */
    versionFailureCode: FailureCode;
}

/** 작업을 끝낸다(failed·cancelled) — 내 token·owner 의 running 행일 때만. 끝냈으면 true */
export async function finishJobTerminal(input: TerminalInput): Promise<boolean> {
    return inTransaction(async (client) => {
        const r = await client.query<{ kind: string; document_version_id: string | null }>(
            `UPDATE knowledge_ingestion_jobs
                SET state = $4, lease_owner = NULL, lease_expires_at = NULL, last_error = $5, updated_at = NOW()
              WHERE id = $1 AND fencing_token = $2 AND lease_owner = $3 AND state = 'running'
              RETURNING kind, document_version_id`,
            [input.jobId, input.token, input.owner, input.state, input.lastError.slice(0, 2000)],
        );
        const row = r.rows[0];
        if (!row) return false;
        if (row.kind === 'ingest' && row.document_version_id) await markVersionTerminal(client, row.document_version_id, input.versionFailureCode);
        return true;
    });
}

/** 문서 버전을 failed 로 — 이미 ready 인 버전은 건드리지 않는다. 문서는 처리 중(processing)일 때만 failed 로 */
export async function markVersionTerminal(client: Pick<PoolClient, 'query'>, versionId: string, code: FailureCode): Promise<void> {
    await client.query(
        `UPDATE knowledge_document_versions SET status = 'failed', failure_code = $2, updated_at = NOW() WHERE id = $1 AND status <> 'ready'`,
        [versionId, code],
    );
    await client.query(
        `UPDATE knowledge_documents SET status = 'failed', updated_at = NOW()
          WHERE id = (SELECT document_id FROM knowledge_document_versions WHERE id = $1) AND status = 'processing'`,
        [versionId],
    );
}
