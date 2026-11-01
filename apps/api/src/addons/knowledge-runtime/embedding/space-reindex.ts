/**
 * 공간 재색인 — 한 공간을 "현재 설정 모델" 의 색인으로 옮긴다(설계 2026-11-01 §6.5).
 * 작업(worker)은 그 공간의 ready·현재 버전·미삭제 문서 청크를 대상 색인에 행위자 키로 다 채우고, 개수 검증 뒤
 * 게시와 같은 잠금 아래에서 공간 포인터를 옛 색인 조건부로 바꾼다. 옛 색인의 벡터는 지우지 않는다(정리는 후속 GC).
 * 전환한 그 트랜잭션에서 공간의 실패(현재 버전) 문서를 "다시 시도" 와 같게 초기화하고 ingest 작업을 넣는다 —
 * 수집은 기존 경로(새 포인터 색인·작업 행위자 키)로 돈다(설계 2026-11-01 PR-A).
 * 키 오류는 다시 해도 같으므로 영구 실패, 그 밖(429·5xx)은 throw → 백오프 재시도(이미 넣은 벡터는 유니크로 중복 0, 이어 하기).
 *
 * @module addons/knowledge-runtime/embedding/space-reindex
 */
import type { PoolClient } from 'pg';
import type { KnowledgeReindexResponse } from '@openmake/shared-types';
import { AppError } from '../../../utils/error-handler';
import { createLogger } from '../../../utils/logger';
import { recordAddonAudit } from '../../../runtime-ports/audit-port';
import { kdb, inTransaction } from '../db';
import { assertLeaseHeld, LeaseLostError, type JobLease } from '../jobs/lease';
import { KnowledgeJobPermanentError } from '../jobs/errors';
import { enqueueJob } from '../jobs/queue';
import { spaceJobActor, type JobActor } from '../jobs/actor';
import { resetVersionForRetry } from '../documents/repository';
import { actorFor } from '../config/scope-policy';
import { getSpaceScopeRow } from '../spaces/repository';
import { FAILURE_CODES, type FailureCode } from '../ingestion/errors';
import { INDEX_PUBLISH_LOCK_KEY } from '../constants';
import { KNOWLEDGE_SPACE_REINDEX_AUDIT_ACTION } from '../contributions';
import { classifyEmbedError, makeIndexEmbedder, type EmbedFn, type EmbeddingFailureReason } from './provider';
import { getIndexById, insertEmbeddings } from './index-catalog';
import { ensureLiveIndex } from './readiness';

const logger = createLogger('KnowledgeReindex');

/** 재임베딩 배치 크기 — provider batch 와 별개로 한 번에 읽어 임베딩할 청크 수 */
const REINDEX_BATCH = Number(process.env.KNOWLEDGE_REINDEX_BATCH) || 128;

/** 키 문제 사유 → 영구 실패 코드(Record 룩업). 표에 없는 사유(provider)는 재시도 대상 */
const PERMANENT_EMBED_FAILURE: Readonly<Partial<Record<EmbeddingFailureReason, FailureCode>>> = {
    unassigned: FAILURE_CODES.EMBEDDING_KEY_MISSING,
    key_missing: FAILURE_CODES.EMBEDDING_KEY_MISSING,
    key_rejected: FAILURE_CODES.EMBEDDING_KEY_REJECTED,
};

/** 공간의 검색 대상 청크(ready·현재 버전·미삭제 문서) FROM·WHERE — spaceParam 은 공간 id 의 바인딩 번호 */
function spaceReadyChunks(spaceParam: string): string {
    return `FROM knowledge_chunks c
            JOIN knowledge_document_versions v ON v.id = c.document_version_id
            JOIN knowledge_documents d ON d.id = v.document_id
           WHERE v.status = 'ready' AND d.deleted_at IS NULL AND d.current_version_id = v.id AND d.space_id = ${spaceParam}`;
}

export interface SpaceReindexJob {
    spaceId: string;
    /** 옮겨 갈 색인(요청 때 요청자의 라이브 배정으로 보장한 ready 색인) */
    indexId: string;
    /** 작업 행위자(요청자) — 외부 모델은 이 사용자의 키로만 임베딩하고, 실패 문서 재수집 작업도 이 행위자로 넣는다 */
    actor: JobActor;
}

/**
 * 재색인 요청(쓰기 권한자) — 요청자의 라이브 배정 색인을 보장(필요하면 요청자 키로 측정 1회)하고 reindex 작업을 넣는다.
 * 같은 색인이면 409 REINDEX_NOT_NEEDED, 진행 중이면 409 REINDEX_IN_PROGRESS, 키 문제 412·측정 실패 502 — 작업은 생기지 않는다.
 */
export async function requestSpaceReindex(userId: string, spaceId: string): Promise<KnowledgeReindexResponse> {
    const space = await getSpaceScopeRow(await actorFor(userId), spaceId, 'write');
    if (!space) throw new AppError('프로젝트', 404, true, 'NOT_FOUND');
    const { index } = await ensureLiveIndex(userId);
    if (index.id === space.embedding_index_id) {
        throw new AppError('이 프로젝트는 이미 현재 설정 모델로 색인되어 있습니다', 409, true, 'REINDEX_NOT_NEEDED');
    }
    // 진행 중 검사와 작업 넣기를 공간별 잠금 아래 한 트랜잭션으로 — 같은 공간 동시 요청이 둘 다 통과하지 못한다
    const jobId = await inTransaction(async (client) => {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('knowledge-space-reindex:' || $1))`, [spaceId]);
        const running = await client.query(
            `SELECT id FROM knowledge_ingestion_jobs WHERE kind = 'reindex' AND space_id = $1 AND state IN ('queued', 'running') LIMIT 1`,
            [spaceId],
        );
        if (running.rows.length > 0) throw new AppError('이 프로젝트는 이미 다시 색인하는 중입니다', 409, true, 'REINDEX_IN_PROGRESS');
        return enqueueJob({ kind: 'reindex', spaceId, embeddingIndexId: index.id, actor: spaceJobActor(userId, space) }, client);
    });
    await recordAddonAudit({
        action: KNOWLEDGE_SPACE_REINDEX_AUDIT_ACTION, userId, resourceType: 'knowledge_space', resourceId: spaceId,
        details: { spaceId, fromIndexId: space.embedding_index_id, toIndexId: index.id, providerRef: index.providerRef, jobId },
    });
    logger.info(`공간 재색인 요청: space=${spaceId} user=${userId} → ${index.id} (${index.providerRef}, dim=${index.dimension})`);
    return { jobId, indexId: index.id };
}

async function readPointer(spaceId: string): Promise<{ found: boolean; indexId: string | null }> {
    const r = await kdb().query<{ embedding_index_id: string | null }>(
        `SELECT embedding_index_id FROM knowledge_spaces WHERE id = $1 AND deleted_at IS NULL`, [spaceId],
    );
    return r.rows[0] ? { found: true, indexId: r.rows[0].embedding_index_id } : { found: false, indexId: null };
}

/** 임베딩 호출 — 키 문제는 코드를 담은 영구 실패로, lease 상실·그 밖은 그대로 */
async function embedOrFail(embed: EmbedFn, texts: string[]): Promise<number[][]> {
    try {
        return await embed(texts);
    } catch (err) {
        if (err instanceof LeaseLostError) throw err;
        const code = PERMANENT_EMBED_FAILURE[classifyEmbedError(err)];
        if (code) throw new KnowledgeJobPermanentError(err instanceof Error ? err.message : String(err), code);
        throw err;
    }
}

/**
 * 전환 트랜잭션 안 — 공간의 실패 현재 버전(실패 코드 불문, queued·running ingest 가 이미 붙은 버전은 제외)을 다시 시도와 같게 초기화하고
 * ingest 를 넣는다. FOR UPDATE OF v 로 같은 순간의 수동 재시도가 이 커밋을 기다린다. 넣은 개수를 돌려준다.
 */
async function requeueFailedDocuments(client: PoolClient, spaceId: string, actor: JobActor): Promise<number> {
    const failed = await client.query<{ document_id: string; version_id: string }>(
        `SELECT d.id AS document_id, v.id AS version_id
           FROM knowledge_documents d
           JOIN knowledge_document_versions v ON v.id = d.current_version_id
          WHERE d.space_id = $1 AND d.deleted_at IS NULL AND d.status <> 'deleted' AND v.status = 'failed'
            AND NOT EXISTS (SELECT 1 FROM knowledge_ingestion_jobs j
                             WHERE j.document_version_id = v.id AND j.state IN ('queued', 'running'))
          FOR UPDATE OF v`,
        [spaceId],
    );
    for (const row of failed.rows) {
        await resetVersionForRetry(client, row.document_id, row.version_id);
        await enqueueJob({ kind: 'ingest', documentVersionId: row.version_id, actor }, client);
    }
    return failed.rows.length;
}

/** 재색인 작업 본체(worker 가 호출) */
export async function runSpaceReindexJob(job: SpaceReindexJob, deps: { embed?: EmbedFn; lease?: JobLease } = {}): Promise<void> {
    const target = await getIndexById(job.indexId);
    if (!target || target.status !== 'ready') {
        throw new KnowledgeJobPermanentError(`재색인 대상 색인이 ready 가 아님: ${job.indexId} (${target?.status ?? '없음'})`);
    }
    const before = await readPointer(job.spaceId);
    if (!before.found) throw new KnowledgeJobPermanentError(`재색인 대상 공간이 없거나 삭제됨: ${job.spaceId}`);
    if (before.indexId === target.id) {
        logger.info(`재색인 건너뜀 — 공간 ${job.spaceId} 은 이미 색인 ${target.id}`);
        return;
    }
    const embed = deps.embed ?? makeIndexEmbedder(target, { userId: job.actor.userId }, { spaceId: job.spaceId });

    // 공간의 청크 중 아직 대상 색인에 없는 것 — 배치마다 lease 를 본다(잃었으면 임베딩 호출 전에 멈춘다)
    for (;;) {
        deps.lease?.throwIfLost();
        const batch = await kdb().query<{ id: string; content: string }>(
            `SELECT c.id, c.content
               ${spaceReadyChunks('$2')}
                AND NOT EXISTS (SELECT 1 FROM knowledge_chunk_embeddings e WHERE e.chunk_id = c.id AND e.embedding_index_id = $1)
              ORDER BY c.id
              LIMIT $3`,
            [target.id, job.spaceId, REINDEX_BATCH],
        );
        if (batch.rows.length === 0) break;
        const vectors = await embedOrFail(embed, batch.rows.map((r) => r.content));
        await inTransaction(async (client) => {
            await assertLeaseHeld(client, deps.lease);
            await insertEmbeddings(client, target.id, batch.rows.map((r, i) => ({ chunkId: r.id, vector: vectors[i] })));
        });
    }

    // 검증 — 공간 청크 수 == 대상 색인의 그 공간 임베딩 수(색인은 여러 공간이 공유한다)
    const expected = await kdb().query<{ n: string }>(`SELECT COUNT(*)::text AS n ${spaceReadyChunks('$1')}`, [job.spaceId]);
    const got = await kdb().query<{ n: string }>(
        `SELECT COUNT(*)::text AS n
           FROM knowledge_chunks c
           JOIN knowledge_chunk_embeddings e ON e.chunk_id = c.id AND e.embedding_index_id = $2
           JOIN knowledge_document_versions v ON v.id = c.document_version_id
           JOIN knowledge_documents d ON d.id = v.document_id
          WHERE v.status = 'ready' AND d.deleted_at IS NULL AND d.current_version_id = v.id AND d.space_id = $1`,
        [job.spaceId, target.id],
    );
    if (Number(expected.rows[0].n) !== Number(got.rows[0].n)) {
        throw new Error(`재색인 검증 실패 — 공간 ${job.spaceId} 청크 ${expected.rows[0].n} vs 임베딩 ${got.rows[0].n}`);
    }

    // 원자 전환 — 게시와 같은 잠금 아래에서 포인터를 다시 읽고(같은 공간의 다른 작업이 먼저 전환했으면 성공으로 끝),
    // 빠진 청크가 없음을 다시 확인한 뒤(검증~전환 사이에 ready 가 된 문서 방지) 옛 색인을 가리킬 때만 바꾼다.
    // 빠진 게 있으면 작업 재시도가 채운다. 옛 색인 벡터는 그대로 둔다. 전환했으면 같은 트랜잭션에서 실패 문서를 재수집에 넣는다
    // (전환하지 않은 경로는 먼저 전환한 작업이 이미 넣었다) — 돌려주는 값은 넣은 개수, 전환 안 했으면 null.
    const requeued = await inTransaction(async (client) => {
        await assertLeaseHeld(client, deps.lease);
        await client.query('SELECT pg_advisory_xact_lock($1)', [INDEX_PUBLISH_LOCK_KEY]);
        const current = (await client.query<{ embedding_index_id: string | null }>(
            `SELECT embedding_index_id FROM knowledge_spaces WHERE id = $1 FOR UPDATE`, [job.spaceId],
        )).rows[0];
        if (current?.embedding_index_id === target.id) return null;
        if (!current || current.embedding_index_id !== before.indexId) {
            throw new KnowledgeJobPermanentError(`재색인 전환 실패 — 공간 ${job.spaceId} 의 색인이 다른 색인(${current?.embedding_index_id ?? '없음'})으로 바뀜`);
        }
        const missing = await client.query<{ n: string }>(
            `SELECT COUNT(*)::text AS n
               ${spaceReadyChunks('$2')}
                AND NOT EXISTS (SELECT 1 FROM knowledge_chunk_embeddings e WHERE e.chunk_id = c.id AND e.embedding_index_id = $1)`,
            [target.id, job.spaceId],
        );
        if (Number(missing.rows[0].n) > 0) {
            throw new Error(`재색인 전환 보류 — 대상 색인에 없는 청크 ${missing.rows[0].n}개(재시도가 채운다)`);
        }
        const switched = await client.query(
            `UPDATE knowledge_spaces SET embedding_index_id = $2, updated_at = NOW()
              WHERE id = $1 AND embedding_index_id IS NOT DISTINCT FROM $3`,
            [job.spaceId, target.id, before.indexId],
        );
        if ((switched.rowCount ?? 0) === 0) {
            throw new KnowledgeJobPermanentError(`재색인 전환 실패 — 공간 ${job.spaceId} 의 색인이 이미 다른 전환으로 바뀜`);
        }
        return requeueFailedDocuments(client, job.spaceId, job.actor);
    });
    if (requeued === null) {
        logger.info(`재색인 전환 건너뜀 — 공간 ${job.spaceId} 은 이미 색인 ${target.id}(같은 공간의 다른 작업이 먼저 전환)`);
        return;
    }
    logger.info(`공간 재색인 완료·전환: space=${job.spaceId} ${before.indexId ?? '(없음)'} → ${target.id} (${target.providerRef}, dim=${target.dimension}) requeued=${requeued}`);
    if (requeued > 0) logger.info(`공간 재색인 뒤 실패 문서 재수집 큐잉: space=${job.spaceId} docs=${requeued}`);
}
