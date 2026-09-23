/**
 * 벡터 검색 SQL — 인가는 결과 후 필터가 아니라 **쿼리의 일부**다.
 * accessPredicate(읽기) + 미삭제 + ready + 현재 버전 + 활성 index 를 한 WHERE 에 넣고
 * `ORDER BY embedding <연산자> $q LIMIT candidateCount`(정확 검색, 아직 ANN 인덱스 없음).
 * 거리 연산자는 활성 index 의 metric 으로 METRIC_OPERATOR 표에서 고른다(인라인 금지).
 *
 * @module addons/knowledge-runtime/retrieval/search
 */
import { kdb } from '../db';
import { accessPredicate, type KnowledgeActor } from '../config/scope-policy';
import { METRIC_OPERATOR, toVectorLiteral, type KnowledgeIndex } from '../embedding/index-manager';

export interface SearchHit {
    chunkId: string;
    documentId: string;
    documentName: string;
    spaceId: string;
    spaceName: string;
    content: string;
    pageStart: number | null;
    pageEnd: number | null;
    /** 0..1 유사도(코사인은 1 - 거리) */
    similarity: number;
}

export interface SearchParams {
    actor: KnowledgeActor;
    /** 검색 범위 Space id 집합 — 채팅은 연결된 한 Space 만 넘긴다 */
    spaceIds: string[];
    queryVector: number[];
    candidateCount: number;
    index: KnowledgeIndex;
}

interface HitRow {
    chunk_id: string; document_id: string; document_name: string;
    space_id: string; space_name: string; content: string;
    page_start: number | null; page_end: number | null; distance: string;
}

/** 코사인 거리(<=>)만 1-d 로 유사도 변환. 그 외 metric 은 거리를 그대로 음수화해 단조성만 유지 */
function toSimilarity(metric: KnowledgeIndex['metric'], distance: number): number {
    return metric === 'cosine' ? 1 - distance : -distance;
}

export async function searchChunks(params: SearchParams): Promise<SearchHit[]> {
    if (params.spaceIds.length === 0) return [];
    const pred = accessPredicate(params.actor, 'read', 's', 1);
    if (pred.sql === 'FALSE') return [];
    // $1.. = accessPredicate params, 그다음 spaceIds, queryVector, index, candidateCount
    const p: unknown[] = [...pred.params];
    const spaceParam = p.push(params.spaceIds);
    const vecParam = p.push(toVectorLiteral(params.queryVector));
    const idxParam = p.push(params.index.id);
    const limitParam = p.push(Math.max(1, params.candidateCount));
    const op = METRIC_OPERATOR[params.index.metric];
    const sql = `
        SELECT c.id AS chunk_id, d.id AS document_id, d.logical_name AS document_name,
               s.id AS space_id, s.name AS space_name, c.content,
               c.page_start, c.page_end,
               (e.embedding ${op} $${vecParam}::vector) AS distance
          FROM knowledge_chunk_embeddings e
          JOIN knowledge_chunks c ON c.id = e.chunk_id
          JOIN knowledge_document_versions v ON v.id = c.document_version_id
          JOIN knowledge_documents d ON d.id = v.document_id
          JOIN knowledge_spaces s ON s.id = d.space_id
         WHERE ${pred.sql}
           AND s.id = ANY($${spaceParam}::text[])
           AND d.deleted_at IS NULL
           AND v.status = 'ready'
           AND d.current_version_id = v.id
           AND e.embedding_index_id = $${idxParam}
         ORDER BY e.embedding ${op} $${vecParam}::vector
         LIMIT $${limitParam}`;
    const rows = (await kdb().query<HitRow>(sql, p)).rows;
    return rows.map((r) => ({
        chunkId: r.chunk_id, documentId: r.document_id, documentName: r.document_name,
        spaceId: r.space_id, spaceName: r.space_name, content: r.content,
        pageStart: r.page_start, pageEnd: r.page_end,
        similarity: toSimilarity(params.index.metric, Number(r.distance)),
    }));
}
