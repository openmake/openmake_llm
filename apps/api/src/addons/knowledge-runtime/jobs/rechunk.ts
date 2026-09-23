/**
 * rechunk 작업 — Space 의 청킹 정책이 바뀌었을 때 ready 문서를 현재 청커 프로필로 다시 나눠 재수집한다.
 * reindex(임베딩 모델 교체)와 다르다: 여기선 문서마다 **새 버전**을 만들어 파이프라인으로 원자 게시한다.
 * 옛 버전은 남지만 document.current_version_id 가 새 버전을 가리키므로 더는 검색되지 않는다.
 *
 * @module addons/knowledge-runtime/jobs/rechunk
 */
import { randomUUID } from 'node:crypto';
import { createLogger } from '../../../utils/logger';
import { kdb } from '../db';
import { ingestVersion, type IngestDeps } from '../ingestion/pipeline';

const logger = createLogger('KnowledgeRechunk');

interface CurrentVersionRow {
    document_id: string;
    content_hash: string;
    mime_type: string;
    original_filename: string;
    storage_ref: string;
    source_size: string;
}

/** Space 의 ready 문서를 모두 새 버전으로 재수집한다 */
export async function rechunkSpace(spaceId: string, deps: IngestDeps = {}): Promise<void> {
    const rows = (await kdb().query<CurrentVersionRow>(
        `SELECT v.document_id, v.content_hash, v.mime_type, v.original_filename, v.storage_ref, v.source_size
           FROM knowledge_documents d
           JOIN knowledge_document_versions v ON v.id = d.current_version_id
          WHERE d.space_id = $1 AND d.deleted_at IS NULL AND d.status = 'ready'`,
        [spaceId],
    )).rows;

    for (const cur of rows) {
        const newVersionId = randomUUID();
        // 원본은 그대로(storage_ref 재사용) — 새 버전 행만 만들어 파이프라인이 다시 청킹·임베딩·게시하게 한다
        await kdb().query(
            `INSERT INTO knowledge_document_versions
               (id, document_id, content_hash, mime_type, original_filename, storage_ref, source_size, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'uploaded')`,
            [newVersionId, cur.document_id, cur.content_hash, cur.mime_type, cur.original_filename, cur.storage_ref, Number(cur.source_size)],
        );
        const res = await ingestVersion(newVersionId, deps);
        if (res.status === 'failed') {
            logger.warn(`rechunk 문서 실패: document=${cur.document_id} code=${res.failureCode}`);
        }
    }
    logger.info(`rechunk 완료: space=${spaceId} docs=${rows.length}`);
}
