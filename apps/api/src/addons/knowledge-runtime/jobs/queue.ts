/**
 * Knowledge 수집 작업 큐 — `knowledge_ingestion_jobs` 에 넣기만 한다(실행은 worker).
 * 라우트·서비스는 이 함수로만 작업을 만든다. 접수 주체(actor)와 접수 시점의 add-on 상태 revision 을 함께 싣는다 —
 * worker 가 claim 때 actor 로 사용권을 다시 판정한다(설계 §5 C4). revision 은 추적용 기록이다(판정은 늘 다시 한다).
 *
 * @module addons/knowledge-runtime/jobs/queue
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { readAddonStateRevision } from '../../../runtime-ports/addon-admission';
import { kdb } from '../db';
import { KNOWLEDGE_ADDON_ID } from '../constants';
import type { JobActor } from './actor';

export type KnowledgeJobKind = 'ingest' | 'reindex' | 'rechunk' | 'cleanup';

export interface EnqueueJobInput {
    kind: KnowledgeJobKind;
    /** 접수 주체 — 사용자·조직 작업은 claim 때 사용권을 다시 본다. 정리·평가는 system */
    actor: JobActor;
    documentVersionId?: string;
    spaceId?: string;
    embeddingIndexId?: string;
    /** 이 시각 이후에 실행(정리 유예 등) */
    runAfter?: Date;
}

/** 작업을 큐에 넣는다 — 트랜잭션 안이면 client 를 넘겨 같은 커밋에 묶는다. revision 조회 실패는 NULL 로 넣는다(접수는 막지 않는다) */
export async function enqueueJob(input: EnqueueJobInput, client?: PoolClient): Promise<string> {
    const id = randomUUID();
    const policyRevision = await readAddonStateRevision(KNOWLEDGE_ADDON_ID);
    await (client ?? kdb()).query(
        `INSERT INTO knowledge_ingestion_jobs
            (id, kind, document_version_id, space_id, embedding_index_id, run_after, actor_kind, actor_user_id, org_id, policy_revision)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()), $7, $8, $9, $10)`,
        [
            id, input.kind, input.documentVersionId ?? null, input.spaceId ?? null, input.embeddingIndexId ?? null,
            input.runAfter?.toISOString() ?? null, input.actor.kind, input.actor.userId, input.actor.orgId, policyRevision,
        ],
    );
    return id;
}
