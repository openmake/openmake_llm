/**
 * 임베딩 색인 카탈로그 — 색인 1행 = (provider_ref, 차원, 거리척도, 요청 params) 로 식별되는 벡터 공간이고 여러 공간이 공유한다.
 * 공간(Space)은 `knowledge_spaces.embedding_index_id` 로 색인 하나에 고정된다(설계 2026-11-01 D4·D5).
 * 같은 모델의 ready 색인은 하나(부분 유니크) — 없을 때만 차원을 1회 재서 ready 로 만든다. 옛 전역 활성(is_active)은 쓰지 않는다.
 * 모델을 바꾸는 길은 공간 재색인(space-reindex) 하나다.
 *
 * @module addons/knowledge-runtime/embedding/index-catalog
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { createLogger } from '../../../utils/logger';
import { kdb } from '../db';
import { KNOWLEDGE_RUNTIME } from '../constants';
import { describeLiveEmbedding, EmbeddingError, probeDimension, type LiveEmbedding } from './provider';

const logger = createLogger('KnowledgeIndex');

export type DistanceMetric = 'cosine' | 'l2' | 'inner_product';

/** 거리척도 → pgvector 연산자. ORDER BY 는 이 표에서 고른다(인라인 연산자 금지) */
export const METRIC_OPERATOR: Readonly<Record<DistanceMetric, string>> = {
    cosine: '<=>',
    l2: '<->',
    inner_product: '<#>',
};

/** 새 색인의 거리척도 — env 오버라이드 */
export const DEFAULT_METRIC: DistanceMetric = ((): DistanceMetric => {
    const v = (process.env.KNOWLEDGE_EMBED_METRIC || 'cosine') as DistanceMetric;
    return v in METRIC_OPERATOR ? v : 'cosine';
})();

export interface KnowledgeIndex {
    id: string;
    providerRef: string;
    modelId: string;
    dimension: number;
    metric: DistanceMetric;
    /** ready(사용 가능) · retired(더 고정되지 않음) · building(006 이전 잔재) */
    status: 'building' | 'ready' | 'retired';
    /** 색인 임베더가 그대로 보내는 요청 params(예: dimensions) */
    requestParams: Record<string, string>;
}

interface IndexRow {
    id: string;
    provider_ref: string;
    model_id: string;
    dimension: number;
    distance_metric: DistanceMetric;
    status: KnowledgeIndex['status'];
    request_params: Record<string, string> | null;
}

function toIndex(r: IndexRow): KnowledgeIndex {
    return {
        id: r.id, providerRef: r.provider_ref, modelId: r.model_id, dimension: r.dimension,
        metric: r.distance_metric, status: r.status, requestParams: r.request_params ?? {},
    };
}

/** 벡터를 pgvector 리터럴로 — `$n::vector` 로 바인딩한다 */
export function toVectorLiteral(vec: number[]): string {
    return `[${vec.join(',')}]`;
}

export async function getIndexById(id: string): Promise<KnowledgeIndex | null> {
    const r = await kdb().query<IndexRow>(`SELECT * FROM knowledge_embedding_indexes WHERE id = $1`, [id]);
    return r.rows[0] ? toIndex(r.rows[0]) : null;
}

/** 여러 색인을 한 번에 — 목록 상태 계산용 */
export async function getIndexesByIds(ids: string[]): Promise<Map<string, KnowledgeIndex>> {
    if (ids.length === 0) return new Map();
    const r = await kdb().query<IndexRow>(`SELECT * FROM knowledge_embedding_indexes WHERE id = ANY($1::text[])`, [ids]);
    return new Map(r.rows.map((row) => [row.id, toIndex(row)]));
}

/**
 * 이 모델의 ready 색인 — params.dimensions 가 있으면 그 차원의 행, 없으면 차원을 지정하지 않고 만든 행.
 * dimension 인자를 주면(측정 뒤 재조회) 그 차원의 행을 고른다.
 */
export async function findReadyIndex(providerRef: string, params: Record<string, string>, dimension?: number): Promise<KnowledgeIndex | null> {
    const dim = dimension ?? (params.dimensions ? Number(params.dimensions) : null);
    const r = await kdb().query<IndexRow>(
        `SELECT * FROM knowledge_embedding_indexes
          WHERE provider_ref = $1 AND distance_metric = $2 AND status = 'ready'
            AND (($3::int IS NULL AND NOT (request_params ? 'dimensions')) OR dimension = $3::int)
          ORDER BY created_at
          LIMIT 1`,
        [providerRef, DEFAULT_METRIC, dim],
    );
    return r.rows[0] ? toIndex(r.rows[0]) : null;
}

/**
 * 라이브 배정의 ready 색인을 보장한다 — 있으면 재사용, 없으면 probe(차원 측정 1회, 행위자 키) 뒤 ready·비활성으로 만든다.
 * 동시 생성은 부분 유니크(provider_ref, dimension, distance_metric WHERE ready)가 막는다 — 충돌하면 이긴 행을 읽는다.
 */
export async function ensureIndexForTarget(
    live: LiveEmbedding,
    probe: () => Promise<{ dimension: number; model: string }>,
): Promise<KnowledgeIndex> {
    const existing = await findReadyIndex(live.fullId, live.params);
    if (existing) return existing;
    const measured = await probe();
    const id = randomUUID();
    const r = await kdb().query<IndexRow>(
        `INSERT INTO knowledge_embedding_indexes (id, provider_ref, model_id, dimension, distance_metric, status, is_active, activated_at, request_params)
         VALUES ($1, $2, $3, $4, $5, 'ready', FALSE, NOW(), $6::jsonb)
         ON CONFLICT (provider_ref, dimension, distance_metric) WHERE status = 'ready' DO NOTHING
         RETURNING *`,
        [id, live.fullId, measured.model, measured.dimension, DEFAULT_METRIC, JSON.stringify(live.params)],
    );
    if (r.rows[0]) {
        logger.info(`임베딩 index 생성: ${id} (${live.fullId}, dim=${measured.dimension}, ${DEFAULT_METRIC})`);
        return toIndex(r.rows[0]);
    }
    const winner = await findReadyIndex(live.fullId, live.params, measured.dimension);
    if (!winner) throw new Error(`임베딩 index 생성 충돌 뒤 재조회 실패 (${live.fullId}, dim=${measured.dimension})`);
    return winner;
}

/** 공간에 고정된 색인 — 없으면 null */
export async function getSpaceIndex(spaceId: string): Promise<KnowledgeIndex | null> {
    const r = await kdb().query<IndexRow>(
        `SELECT i.* FROM knowledge_spaces s JOIN knowledge_embedding_indexes i ON i.id = s.embedding_index_id WHERE s.id = $1`,
        [spaceId],
    );
    return r.rows[0] ? toIndex(r.rows[0]) : null;
}

/** 비어 있는 공간에 색인을 고정한다 — 이미 다른 작업이 고정했으면 그 색인 id 를 돌려준다 */
export async function pinSpaceIndex(spaceId: string, indexId: string): Promise<string> {
    const r = await kdb().query<{ embedding_index_id: string }>(
        `UPDATE knowledge_spaces SET embedding_index_id = $2 WHERE id = $1 AND embedding_index_id IS NULL RETURNING embedding_index_id`,
        [spaceId, indexId],
    );
    if (r.rows[0]) return r.rows[0].embedding_index_id;
    const cur = await kdb().query<{ embedding_index_id: string | null }>(`SELECT embedding_index_id FROM knowledge_spaces WHERE id = $1`, [spaceId]);
    const pinned = cur.rows[0]?.embedding_index_id;
    if (!pinned) throw new Error(`공간 색인 고정 실패 — 공간 없음: ${spaceId}`);
    return pinned;
}

/**
 * 공간의 색인을 보장한다 — 고정돼 있으면 조회만, 비었으면(006 이전 경합·직접 생성 행) 행위자의 라이브 배정으로 고정한다.
 * 라이브 배정을 실행할 수 없으면 EmbeddingError(reason) — 색인·고정 쓰기 없음.
 */
export async function ensureSpaceIndex(spaceId: string, actorUserId?: string | null): Promise<KnowledgeIndex> {
    const pinned = await getSpaceIndex(spaceId);
    if (pinned) return pinned;
    const state = await describeLiveEmbedding(actorUserId);
    if (!state.live || state.failure) {
        const failure = state.failure ?? { reason: 'unassigned' as const, message: '임베딩 모델이 배정되어 있지 않습니다' };
        throw new EmbeddingError(failure.reason, failure.message);
    }
    const live = state.live;
    const index = await ensureIndexForTarget(live, () => probeDimension(live, { userId: actorUserId }));
    const pinnedId = await pinSpaceIndex(spaceId, index.id);
    if (pinnedId === index.id) return index;
    const other = await getIndexById(pinnedId);
    if (!other) throw new Error(`공간 ${spaceId} 이 가리키는 색인이 없습니다: ${pinnedId}`);
    return other;
}

/**
 * 임베딩 행 upsert — 재시도에도 (chunk, index) 유니크로 중복 0.
 * `WRITE_BATCH_ROWS` 행씩 unnest 배열 한 문장으로 넣는다(같은 트랜잭션 안에서 반복). 벡터는 텍스트 배열로 보내 행마다 `::vector` 캐스트.
 * 한 문장 안에 같은 chunkId 가 두 번 오면 ON CONFLICT DO UPDATE 가 오류를 낸다 — 호출처(수집·재색인)는 청크 id 가 유일하다.
 */
export async function insertEmbeddings(
    client: PoolClient,
    indexId: string,
    rows: Array<{ chunkId: string; vector: number[] }>,
): Promise<void> {
    for (let i = 0; i < rows.length; i += KNOWLEDGE_RUNTIME.WRITE_BATCH_ROWS) {
        const batch = rows.slice(i, i + KNOWLEDGE_RUNTIME.WRITE_BATCH_ROWS);
        await client.query(
            `INSERT INTO knowledge_chunk_embeddings (id, chunk_id, embedding_index_id, embedding)
             SELECT u.id, u.chunk_id, $1, u.embedding::vector
               FROM unnest($2::text[], $3::text[], $4::text[]) AS u(id, chunk_id, embedding)
             ON CONFLICT (chunk_id, embedding_index_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
            [indexId, batch.map(() => randomUUID()), batch.map((r) => r.chunkId), batch.map((r) => toVectorLiteral(r.vector))],
        );
    }
}

/** 특정 청크들 중 이 색인에 임베딩이 있는 수 */
export async function countEmbeddings(indexId: string, chunkIds: string[]): Promise<number> {
    if (chunkIds.length === 0) return 0;
    const r = await kdb().query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM knowledge_chunk_embeddings WHERE embedding_index_id = $1 AND chunk_id = ANY($2::text[])`,
        [indexId, chunkIds],
    );
    return Number(r.rows[0].n);
}
