/**
 * 임베딩 index 관리 — 벡터는 index 단위로 산다(모델·차원·거리척도는 index 행이 기록).
 * 모델을 바꾸면(reindex) 새 index 를 building 으로 만들어 전부 임베딩·검증한 뒤 **원자 전환**한다.
 * 청크 정책 변경(rechunk)은 index 가 아니라 재수집이므로 여기 있지 않다.
 *
 * @module addons/knowledge-runtime/embedding/index-manager
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { createLogger } from '../../../utils/logger';
import { kdb, inTransaction } from '../db';
import { enqueueJob } from '../jobs/queue';
import { INDEX_PUBLISH_LOCK_KEY } from '../constants';
import { describeEmbeddingProvider, makeIndexEmbedder, type EmbedFn } from './provider';

const logger = createLogger('KnowledgeIndex');

export type DistanceMetric = 'cosine' | 'l2' | 'inner_product';

/** 거리척도 → pgvector 연산자. ORDER BY 는 이 표에서 고른다(인라인 연산자 금지) */
export const METRIC_OPERATOR: Readonly<Record<DistanceMetric, string>> = {
    cosine: '<=>',
    l2: '<->',
    inner_product: '<#>',
};

/** 기본 거리척도 — env 오버라이드 */
const DEFAULT_METRIC: DistanceMetric = ((): DistanceMetric => {
    const v = (process.env.KNOWLEDGE_EMBED_METRIC || 'cosine') as DistanceMetric;
    return v in METRIC_OPERATOR ? v : 'cosine';
})();

/** 재임베딩 배치 크기 — provider batch 와 별개로 한 번에 읽어 임베딩할 청크 수 */
const REINDEX_BATCH = Number(process.env.KNOWLEDGE_REINDEX_BATCH) || 128;

export interface KnowledgeIndex {
    id: string;
    providerRef: string;
    modelId: string;
    dimension: number;
    metric: DistanceMetric;
    status: 'building' | 'ready' | 'retired';
    isActive: boolean;
}

interface IndexRow {
    id: string;
    provider_ref: string;
    model_id: string;
    dimension: number;
    distance_metric: DistanceMetric;
    status: KnowledgeIndex['status'];
    is_active: boolean;
}

function toIndex(r: IndexRow): KnowledgeIndex {
    return {
        id: r.id, providerRef: r.provider_ref, modelId: r.model_id, dimension: r.dimension,
        metric: r.distance_metric, status: r.status, isActive: r.is_active,
    };
}

/** 벡터를 pgvector 리터럴로 — `$n::vector` 로 바인딩한다 */
export function toVectorLiteral(vec: number[]): string {
    return `[${vec.join(',')}]`;
}

export async function getActiveIndex(): Promise<KnowledgeIndex | null> {
    const r = await kdb().query<IndexRow>(
        `SELECT * FROM knowledge_embedding_indexes WHERE is_active = TRUE LIMIT 1`,
    );
    return r.rows[0] ? toIndex(r.rows[0]) : null;
}

async function getIndexById(id: string): Promise<KnowledgeIndex | null> {
    const r = await kdb().query<IndexRow>(`SELECT * FROM knowledge_embedding_indexes WHERE id = $1`, [id]);
    return r.rows[0] ? toIndex(r.rows[0]) : null;
}

/**
 * 활성 index 를 보장한다 — 없으면 provider 를 해석해 첫 index(ready·is_active)를 만든다.
 * 경합(동시 생성)은 is_active 부분 유니크 인덱스가 막는다 — 충돌하면 이미 만들어진 활성 index 를 읽는다.
 */
export async function ensureActiveIndex(): Promise<KnowledgeIndex> {
    const existing = await getActiveIndex();
    if (existing) return existing;
    const info = await describeEmbeddingProvider();
    const id = randomUUID();
    try {
        await kdb().query(
            `INSERT INTO knowledge_embedding_indexes (id, provider_ref, model_id, dimension, distance_metric, status, is_active, activated_at)
             VALUES ($1, $2, $3, $4, $5, 'ready', TRUE, NOW())`,
            [id, info.providerRef, info.modelId, info.dimension, DEFAULT_METRIC],
        );
        logger.info(`활성 임베딩 index 생성: ${id} (${info.providerRef}, dim=${info.dimension}, ${DEFAULT_METRIC})`);
        return (await getIndexById(id))!;
    } catch (err) {
        // 부분 유니크(is_active) 충돌 — 다른 프로세스가 먼저 만들었다
        const active = await getActiveIndex();
        if (active) return active;
        throw err;
    }
}

/** 임베딩 행 upsert — 재시도에도 (chunk, index) 유니크로 중복 0 */
export async function insertEmbeddings(
    client: PoolClient,
    indexId: string,
    rows: Array<{ chunkId: string; vector: number[] }>,
): Promise<void> {
    for (const row of rows) {
        await client.query(
            `INSERT INTO knowledge_chunk_embeddings (id, chunk_id, embedding_index_id, embedding)
             VALUES ($1, $2, $3, $4::vector)
             ON CONFLICT (chunk_id, embedding_index_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
            [randomUUID(), row.chunkId, indexId, toVectorLiteral(row.vector)],
        );
    }
}

/** 특정 청크들 중 이 index 에 임베딩이 있는 수 */
export async function countEmbeddings(indexId: string, chunkIds: string[]): Promise<number> {
    if (chunkIds.length === 0) return 0;
    const r = await kdb().query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM knowledge_chunk_embeddings WHERE embedding_index_id = $1 AND chunk_id = ANY($2::text[])`,
        [indexId, chunkIds],
    );
    return Number(r.rows[0].n);
}

/** reindex 시작 — building index 생성 + reindex 작업 큐잉. 반환은 새 index id */
export async function startReindex(): Promise<{ indexId: string }> {
    const info = await describeEmbeddingProvider();
    const indexId = randomUUID();
    await inTransaction(async (client) => {
        await client.query(
            `INSERT INTO knowledge_embedding_indexes (id, provider_ref, model_id, dimension, distance_metric, status, is_active)
             VALUES ($1, $2, $3, $4, $5, 'building', FALSE)`,
            [indexId, info.providerRef, info.modelId, info.dimension, DEFAULT_METRIC],
        );
        await enqueueJob({ kind: 'reindex', embeddingIndexId: indexId }, client);
    });
    logger.info(`reindex 시작: ${indexId} (${info.providerRef})`);
    return { indexId };
}

/**
 * reindex 작업 본체(worker 가 호출) — ready 문서의 모든 청크를 새 index 로 임베딩하고,
 * 개수 검증 후 한 트랜잭션에서 활성 index 를 교체한다.
 */
export async function runReindexJob(indexId: string, deps: { embed?: EmbedFn } = {}): Promise<void> {
    const target = await getIndexById(indexId);
    if (!target) throw new Error(`reindex 대상 index 없음: ${indexId}`);
    // 새(building) index 는 startReindex 에서 라이브 배정으로 기록됐다 — 그 기록 모델로 임베딩한다(= reindex 는 라이브 배정을 반영).
    const embed = deps.embed ?? makeIndexEmbedder(target);
    if (target.status !== 'building') {
        logger.info(`reindex 건너뜀 — index ${indexId} 상태가 building 이 아님(${target.status})`);
        return;
    }

    // ready·게시된(현재 버전)·미삭제 문서의 청크 중 아직 이 index 에 없는 것
    for (;;) {
        const batch = await kdb().query<{ id: string; content: string }>(
            `SELECT c.id, c.content
               FROM knowledge_chunks c
               JOIN knowledge_document_versions v ON v.id = c.document_version_id
               JOIN knowledge_documents d ON d.id = v.document_id
              WHERE v.status = 'ready' AND d.deleted_at IS NULL AND d.current_version_id = v.id
                AND NOT EXISTS (
                    SELECT 1 FROM knowledge_chunk_embeddings e
                     WHERE e.chunk_id = c.id AND e.embedding_index_id = $1)
              ORDER BY c.id
              LIMIT $2`,
            [indexId, REINDEX_BATCH],
        );
        if (batch.rows.length === 0) break;
        const vectors = await embed(batch.rows.map((r) => r.content));
        await inTransaction(async (client) => {
            await insertEmbeddings(client, indexId, batch.rows.map((r, i) => ({ chunkId: r.id, vector: vectors[i] })));
        });
    }

    // 검증 — 대상 청크 수 == 새 index 임베딩 수
    const expected = await kdb().query<{ n: string }>(
        `SELECT COUNT(*)::text AS n
           FROM knowledge_chunks c
           JOIN knowledge_document_versions v ON v.id = c.document_version_id
           JOIN knowledge_documents d ON d.id = v.document_id
          WHERE v.status = 'ready' AND d.deleted_at IS NULL AND d.current_version_id = v.id`,
    );
    const got = await kdb().query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM knowledge_chunk_embeddings WHERE embedding_index_id = $1`,
        [indexId],
    );
    if (Number(expected.rows[0].n) !== Number(got.rows[0].n)) {
        throw new Error(`reindex 검증 실패 — 청크 ${expected.rows[0].n} vs 임베딩 ${got.rows[0].n}`);
    }

    // 원자 전환 — 게시와 같은 잠금 아래에서 빠진 청크가 없음을 다시 확인한 뒤(검증~전환 사이에 ready 가 된 문서 방지)
    // 이전 활성을 먼저 내리고(부분 유니크 충돌 방지) 새 index 를 올린다. 빠진 게 있으면 작업 재시도가 채운다.
    await inTransaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock($1)', [INDEX_PUBLISH_LOCK_KEY]);
        const missing = await client.query<{ n: string }>(
            `SELECT COUNT(*)::text AS n
               FROM knowledge_chunks c
               JOIN knowledge_document_versions v ON v.id = c.document_version_id
               JOIN knowledge_documents d ON d.id = v.document_id
              WHERE v.status = 'ready' AND d.deleted_at IS NULL AND d.current_version_id = v.id
                AND NOT EXISTS (SELECT 1 FROM knowledge_chunk_embeddings e WHERE e.chunk_id = c.id AND e.embedding_index_id = $1)`,
            [indexId],
        );
        if (Number(missing.rows[0].n) > 0) {
            throw new Error(`reindex 전환 보류 — 새 index 에 없는 청크 ${missing.rows[0].n}개(재시도가 채운다)`);
        }
        await client.query(
            `UPDATE knowledge_embedding_indexes SET is_active = FALSE, status = 'retired', retired_at = NOW()
              WHERE is_active = TRUE AND id <> $1`,
            [indexId],
        );
        await client.query(
            `UPDATE knowledge_embedding_indexes SET is_active = TRUE, status = 'ready', activated_at = NOW()
              WHERE id = $1`,
            [indexId],
        );
    });
    logger.info(`reindex 완료·전환: ${indexId}`);
}
