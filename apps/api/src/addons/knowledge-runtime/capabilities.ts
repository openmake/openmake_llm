/**
 * Knowledge 사용 가능 여부 — pgvector·임베딩 provider·파서 3축을 점검한다.
 * 어느 하나라도 실패하면 ready:false + 기계 판독 사유(blockedReasons). 파이프라인 모듈은 add-on 이 공급.
 *
 * @module addons/knowledge-runtime/capabilities
 */
import type { KnowledgeCapabilities } from '@openmake/shared-types';
import { kdb } from './db';
import { getDefaultLimits } from './config/profiles';
import { describeEmbeddingProvider } from './embedding/provider';
import { supportedMimeTypes } from './ingestion/parser-registry';

/** pgvector 확장 버전 — 없으면 null */
export async function pgvectorVersion(): Promise<string | null> {
    const r = await kdb().query<{ extversion: string }>(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`);
    return r.rows[0]?.extversion ?? null;
}

export async function getCapabilities(): Promise<KnowledgeCapabilities> {
    const blockedReasons: string[] = [];
    const limits = await getDefaultLimits();

    const vectorVer = await pgvectorVersion().catch(() => null);
    if (!vectorVer) blockedReasons.push('PGVECTOR_MISSING');

    let embedding: KnowledgeCapabilities['embedding'] = null;
    try {
        embedding = await describeEmbeddingProvider();
    } catch {
        blockedReasons.push('EMBEDDING_PROVIDER_UNAVAILABLE');
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
