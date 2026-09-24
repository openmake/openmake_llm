/**
 * K08 재시작/중복 평가 — 재수집·lease 만료(fencing) 뒤에도 청크 중복이 0 임을 실증한다.
 *
 *  - double_ingest: 같은 버전을 다시 수집한다(replaceChunks 가 기존 청크를 지우고 다시 넣음).
 *  - lease_expiry: 죽은 실행자가 lease 를 쥔 채 만료된 상황을 만들고(job 을 stale running 으로),
 *    worker 가 재선점(fencing_token +1)해 완료하게 한다 — 옛 실행자의 완료는 fencing 으로 거절된다.
 *
 * 판정: 각 버전의 (version, sequence) 중복 수 = 0, 활성 index 임베딩 수 == 청크 수.
 *
 * @module addons/knowledge-runtime/evaluation/restart-eval
 */
import { kdb } from '../db';
import { ingestVersion } from '../ingestion/pipeline';
import { enqueueJob } from '../jobs/queue';
import { KnowledgeWorker } from '../jobs/worker';
import { getActiveIndex } from '../embedding/index-manager';
import type { EvalCase, EvalDataset } from './types';
import type { SeedContext } from './seeding';

export interface RestartCaseResult {
    caseId: string;
    docKey: string;
    mode: string;
    duplicateChunks: number;
    chunkCount: number;
    embeddingCount: number;
    embeddingsMatch: boolean;
}

export interface RestartEvalResult {
    perCase: RestartCaseResult[];
    duplicateChunksAfterRetry: number;
    embeddingMismatches: number;
}

async function measureVersion(versionId: string): Promise<{ dups: number; chunks: number; embeddings: number }> {
    const dups = Number((await kdb().query<{ n: string }>(
        `SELECT COALESCE(SUM(c - 1), 0)::text AS n FROM (
             SELECT COUNT(*) AS c FROM knowledge_chunks WHERE document_version_id = $1 GROUP BY sequence HAVING COUNT(*) > 1
         ) t`, [versionId])).rows[0].n);
    const chunks = Number((await kdb().query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM knowledge_chunks WHERE document_version_id = $1`, [versionId])).rows[0].n);
    const index = await getActiveIndex();
    const embeddings = index ? Number((await kdb().query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM knowledge_chunk_embeddings e
         JOIN knowledge_chunks c ON c.id = e.chunk_id
         WHERE c.document_version_id = $1 AND e.embedding_index_id = $2`, [versionId, index.id])).rows[0].n) : 0;
    return { dups, chunks, embeddings };
}

/** lease 만료 시뮬레이션 — 죽은 실행자가 running 으로 쥔 job 을 만들고 worker 가 재선점하게 한다 */
async function simulateLeaseExpiry(versionId: string): Promise<void> {
    const jobId = await enqueueJob({ kind: 'ingest', documentVersionId: versionId });
    // 죽은 실행자가 lease 를 쥔 채 만료된 상태로 만든다(fencing_token 을 올려 옛 토큰을 무효화 대상으로).
    await kdb().query(
        `UPDATE knowledge_ingestion_jobs
            SET state = 'running', lease_owner = 'stale-worker', lease_expires_at = NOW() - INTERVAL '1 second',
                fencing_token = 7, attempts = 1
          WHERE id = $1`, [jobId]);
    // 정상 worker 가 만료 lease 를 재선점해 처리·완료한다(fencing_token 8 로).
    const worker = new KnowledgeWorker({});
    for (let i = 0; i < 5; i++) {
        const n = await worker.tick();
        const done = (await kdb().query<{ state: string }>(`SELECT state FROM knowledge_ingestion_jobs WHERE id = $1`, [jobId])).rows[0];
        if (done?.state === 'done') break;
        if (n === 0) break;
    }
    // 처리된 job 행 정리(teardown 에서 CASCADE 되지만 재사용을 위해 지운다)
    await kdb().query(`DELETE FROM knowledge_ingestion_jobs WHERE id = $1`, [jobId]);
}

export async function runRestartEval(dataset: EvalDataset, seed: SeedContext): Promise<RestartEvalResult> {
    const perCase: RestartCaseResult[] = [];
    let duplicateChunksAfterRetry = 0;
    let embeddingMismatches = 0;

    const restartCases = dataset.cases.filter((c: EvalCase) => c.category === 'restart');
    for (const c of restartCases) {
        const versionId = seed.docs[c.restartDocKey!].versionId;
        if (c.restartMode === 'double_ingest') {
            await ingestVersion(versionId); // 실 임베딩 재수집
        } else {
            await simulateLeaseExpiry(versionId);
        }
        const m = await measureVersion(versionId);
        const embeddingsMatch = m.embeddings === m.chunks;
        duplicateChunksAfterRetry += m.dups;
        if (!embeddingsMatch) embeddingMismatches += 1;
        perCase.push({
            caseId: c.id, docKey: c.restartDocKey!, mode: c.restartMode!,
            duplicateChunks: m.dups, chunkCount: m.chunks, embeddingCount: m.embeddings, embeddingsMatch,
        });
    }
    return { perCase, duplicateChunksAfterRetry, embeddingMismatches };
}
