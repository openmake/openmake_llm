/**
 * Knowledge 수집 작업 큐 — `knowledge_ingestion_jobs` 에 넣기만 한다(실행은 worker).
 * 라우트·서비스는 이 함수로만 작업을 만든다.
 *
 * @module addons/knowledge-runtime/jobs/queue
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { kdb } from '../db';

export type KnowledgeJobKind = 'ingest' | 'reindex' | 'rechunk' | 'cleanup';

export interface EnqueueJobInput {
    kind: KnowledgeJobKind;
    documentVersionId?: string;
    spaceId?: string;
    embeddingIndexId?: string;
    /** 이 시각 이후에 실행(정리 유예 등) */
    runAfter?: Date;
}

/** 작업을 큐에 넣는다 — 트랜잭션 안이면 client 를 넘겨 같은 커밋에 묶는다 */
export async function enqueueJob(input: EnqueueJobInput, client?: PoolClient): Promise<string> {
    const id = randomUUID();
    await (client ?? kdb()).query(
        `INSERT INTO knowledge_ingestion_jobs (id, kind, document_version_id, space_id, embedding_index_id, run_after)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()))`,
        [id, input.kind, input.documentVersionId ?? null, input.spaceId ?? null, input.embeddingIndexId ?? null, input.runAfter?.toISOString() ?? null],
    );
    return id;
}
