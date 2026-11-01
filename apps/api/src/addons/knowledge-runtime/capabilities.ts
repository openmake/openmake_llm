/**
 * Knowledge 사용 가능 여부 — pgvector·임베딩·파서 3축을 점검한다(요청 사용자 기준).
 * 어느 하나라도 실패하면 ready:false + 기계 판독 사유(blockedReasons). 파이프라인 모듈은 add-on 이 공급.
 * 임베딩은 사용자의 실효 배정과 그 키 상태만 본다 — 공급자 호출·차원 측정·키 복호화 없음
 * (로컬 게이트웨이 생존은 수집 단계가 FAILED_EMBEDDING 으로 드러낸다).
 *
 * @module addons/knowledge-runtime/capabilities
 */
import type { KnowledgeCapabilities } from '@openmake/shared-types';
import { kdb } from './db';
import { getDefaultLimits } from './config/profiles';
import { describeLiveEmbedding } from './embedding/provider';
import { findReadyIndex } from './embedding/index-catalog';
import { embeddingReasonCode, embeddingReasonStatus } from './embedding/readiness';
import { supportedMimeTypes } from './ingestion/parser-registry';

/** pgvector 확장 버전 — 없으면 null */
export async function pgvectorVersion(): Promise<string | null> {
    const r = await kdb().query<{ extversion: string }>(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`);
    return r.rows[0]?.extversion ?? null;
}

export async function getCapabilities(userId: string): Promise<KnowledgeCapabilities> {
    const blockedReasons: string[] = [];
    const limits = await getDefaultLimits();

    const vectorVer = await pgvectorVersion().catch(() => null);
    if (!vectorVer) blockedReasons.push('PGVECTOR_MISSING');

    const state = await describeLiveEmbedding(userId);
    if (state.failure) blockedReasons.push(embeddingReasonCode(state.failure.reason));
    let embedding: KnowledgeCapabilities['embedding'] = null;
    if (state.live) {
        const known = await findReadyIndex(state.live.fullId, state.live.params);
        embedding = {
            providerRef: state.live.fullId, modelId: state.live.model, source: state.live.source,
            status: state.failure ? embeddingReasonStatus(state.failure.reason) : 'ready',
            dimension: known?.dimension ?? null,
        };
    }

    // 파서가 지원하는 MIME 과 정책 허용 목록의 교집합만 실제 업로드 가능
    let supported: string[] = [];
    try {
        const allowed = new Set(limits.allowedMimeTypes);
        supported = supportedMimeTypes().filter((m) => allowed.has(m));
        if (supported.length === 0) blockedReasons.push('NO_SUPPORTED_MIME_TYPES');
    } catch {
        blockedReasons.push('PARSER_REGISTRY_UNAVAILABLE');
    }

    return {
        ready: blockedReasons.length === 0,
        blockedReasons,
        supportedMimeTypes: supported,
        maxFileBytes: limits.maxFileBytes,
        embedding,
    };
}
