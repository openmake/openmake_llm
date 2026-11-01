/**
 * 공간 임베딩 준비 상태 — 서버가 판정하고 화면은 그린다(설계 2026-11-01 §6.2·6.3·6.8).
 *  - embeddingAppError: 실패 사유 → HTTP 오류(412 키·미배정, 502 공급자)
 *  - ensureLiveIndex: 요청자의 라이브 배정으로 색인을 보장(공간 생성·재색인 요청)
 *  - describeSpaceEmbeddings: 공간 목록·상세의 embedding(색인·상태·현재 설정·mismatch) — 복호화·공급자 호출 없음
 *  - assertSpaceEmbeddingReady: 업로드·재시도 선검사(파일 저장·작업 생성 전, 공급자 호출 없음)
 *
 * @module addons/knowledge-runtime/embedding/readiness
 */
import type { KnowledgeEmbeddingIndexInfo, KnowledgeEmbeddingStatus, KnowledgeEmbeddingState } from '@openmake/shared-types';
import { AppError } from '../../../utils/error-handler';
import { kdb } from '../db';
import {
    checkEmbeddingAvailability, classifyEmbedError, describeLiveEmbedding, probeDimension,
    type EmbeddingAvailability, type EmbeddingFailureReason, type LiveEmbedding,
} from './provider';
import { ensureIndexForTarget, getIndexById, getIndexesByIds, type KnowledgeIndex } from './index-catalog';

/** 실패 사유 → HTTP 상태·오류 코드(Record 룩업) */
const REASON_HTTP: Readonly<Record<EmbeddingFailureReason, { status: number; code: string }>> = {
    unassigned: { status: 412, code: 'EMBEDDING_UNASSIGNED' },
    key_missing: { status: 412, code: 'EMBEDDING_KEY_MISSING' },
    key_rejected: { status: 412, code: 'EMBEDDING_KEY_REJECTED' },
    provider: { status: 502, code: 'EMBEDDING_PROVIDER_UNAVAILABLE' },
};

/** 실패 사유 → 공간 임베딩 상태. provider(카탈로그·게이트웨이 밖 등 키 외 사유)도 "지금 이 모델을 못 쓴다" 로 key_missing 에 묶는다 */
const REASON_STATUS: Readonly<Record<EmbeddingFailureReason, KnowledgeEmbeddingStatus>> = {
    unassigned: 'unassigned',
    key_missing: 'key_missing',
    key_rejected: 'key_rejected',
    provider: 'key_missing',
};

/** 실패 사유 → 기계 판독 코드(412/502 의 code, capabilities.blockedReasons) */
export function embeddingReasonCode(reason: EmbeddingFailureReason): string {
    return REASON_HTTP[reason].code;
}

/** 실패 사유 → 공간 임베딩 상태 */
export function embeddingReasonStatus(reason: EmbeddingFailureReason): KnowledgeEmbeddingStatus {
    return REASON_STATUS[reason];
}

/** 실패 사유를 AppError 로 — message 는 해석기·provider 문구(provider id·모델명만, 키 없음) */
export function embeddingAppError(reason: EmbeddingFailureReason, message: string): AppError {
    const http = REASON_HTTP[reason];
    return new AppError(message, http.status, true, http.code);
}

function toIndexInfo(index: KnowledgeIndex): KnowledgeEmbeddingIndexInfo {
    return { id: index.id, providerRef: index.providerRef, modelId: index.modelId, dimension: index.dimension, distanceMetric: index.metric };
}

/** 색인 모델과 현재 설정이 다른가 — 모델이 다르거나, 설정이 차원을 지정했는데 색인 차원과 다르면 */
function isMismatch(index: KnowledgeIndex, live: LiveEmbedding): boolean {
    if (index.providerRef !== live.fullId) return true;
    return !!live.params.dimensions && Number(live.params.dimensions) !== index.dimension;
}

/** 공간 상태 계산에 필요한 최소 행 */
export interface SpaceEmbeddingRow {
    id: string;
    embedding_index_id: string | null;
}

/**
 * 공간들의 embedding 을 계산한다 — 라이브 해석은 요청당 1회, 가용성은 providerRef 별 1회(공간 N개 → 공급자 수만큼),
 * 재색인 진행 여부는 한 쿼리. 키 복호화·공급자 호출은 없다.
 */
export async function describeSpaceEmbeddings(spaces: SpaceEmbeddingRow[], userId: string): Promise<Map<string, KnowledgeEmbeddingState>> {
    const out = new Map<string, KnowledgeEmbeddingState>();
    if (spaces.length === 0) return out;
    const pinnedIds = [...new Set(spaces.map((s) => s.embedding_index_id).filter((v): v is string => !!v))];
    const [state, indexes, reindexing] = await Promise.all([
        describeLiveEmbedding(userId),
        getIndexesByIds(pinnedIds),
        kdb().query<{ space_id: string }>(
            `SELECT DISTINCT space_id FROM knowledge_ingestion_jobs
              WHERE kind = 'reindex' AND state IN ('queued', 'running') AND space_id = ANY($1::text[])`,
            [spaces.map((s) => s.id)],
        ),
    ]);
    const reindexingIds = new Set(reindexing.rows.map((r) => r.space_id));
    const availability = new Map<string, EmbeddingAvailability>();
    for (const ref of new Set([...indexes.values()].map((i) => i.providerRef))) {
        availability.set(ref, await checkEmbeddingAvailability(ref, userId));
    }
    const live = state.live;
    const effective = live ? { providerRef: live.fullId, modelId: live.model, source: live.source } : null;
    for (const space of spaces) {
        const index = space.embedding_index_id ? indexes.get(space.embedding_index_id) ?? null : null;
        let status: KnowledgeEmbeddingStatus = 'ready';
        if (!index) status = 'unpinned';
        else if (reindexingIds.has(space.id)) status = 'reindexing';
        else if (state.failure?.reason === 'unassigned') status = 'unassigned';
        else {
            const avail = availability.get(index.providerRef);
            if (avail && !avail.ok) status = embeddingReasonStatus(avail.reason);
        }
        out.set(space.id, {
            index: index ? toIndexInfo(index) : null,
            status,
            effective,
            mismatch: !!index && !!live && isMismatch(index, live),
        });
    }
    return out;
}

/**
 * 업로드·재시도 선검사 — 공간 색인 모델을 이 사용자의 키로 지금 쓸 수 있는가(거절 메모·키 행만, 공급자 호출 없음).
 * 색인이 비어 있으면 라이브 배정으로 본다(첫 수집이 그 모델로 고정한다). 실패는 412(코드)·502.
 */
export async function assertSpaceEmbeddingReady(space: SpaceEmbeddingRow, userId: string): Promise<void> {
    const index = space.embedding_index_id ? await getIndexById(space.embedding_index_id) : null;
    if (index) {
        const avail = await checkEmbeddingAvailability(index.providerRef, userId);
        if (!avail.ok) throw embeddingAppError(avail.reason, avail.message);
        return;
    }
    const state = await describeLiveEmbedding(userId);
    if (state.failure) throw embeddingAppError(state.failure.reason, state.failure.message);
}

/**
 * 요청자의 라이브 배정으로 ready 색인을 보장한다 — 실행 불가(미배정·키)는 412, 차원 측정(요청자 키, 모델당 최초 1회) 실패는
 * 키 거절이면 412 그 밖 502. 공급자 호출은 색인 행이 없을 때만.
 */
export async function ensureLiveIndex(userId: string): Promise<{ live: LiveEmbedding; index: KnowledgeIndex }> {
    const state = await describeLiveEmbedding(userId);
    if (!state.live || state.failure) {
        const failure = state.failure ?? { reason: 'unassigned' as const, message: '임베딩 모델이 배정되어 있지 않습니다' };
        throw embeddingAppError(failure.reason, failure.message);
    }
    const live = state.live;
    const index = await ensureIndexForTarget(live, async () => {
        try {
            return await probeDimension(live, { userId });
        } catch (err) {
            throw embeddingAppError(classifyEmbedError(err), `임베딩 모델 '${live.fullId}' 차원 측정 실패 — 임베딩 모델인지 확인하세요: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    return { live, index };
}
