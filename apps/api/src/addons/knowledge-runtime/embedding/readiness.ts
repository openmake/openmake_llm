/**
 * 공간 임베딩 준비 상태 — 서버가 판정하고 화면은 그린다(설계 2026-11-01 §6.2·6.3·6.8).
 *  - embeddingAppError: 실패 사유 → HTTP 오류(412 키·미배정, 502 공급자)
 *  - ensureLiveIndex: 요청자의 라이브 배정으로 색인을 보장(공간 생성·재색인 요청)
 *
 * @module addons/knowledge-runtime/embedding/readiness
 */
import { AppError } from '../../../utils/error-handler';
import { classifyEmbedError, describeLiveEmbedding, probeDimension, type EmbeddingFailureReason, type LiveEmbedding } from './provider';
import { ensureIndexForTarget, type KnowledgeIndex } from './index-catalog';

/** 실패 사유 → HTTP 상태·오류 코드(Record 룩업) */
const REASON_HTTP: Readonly<Record<EmbeddingFailureReason, { status: number; code: string }>> = {
    unassigned: { status: 412, code: 'EMBEDDING_UNASSIGNED' },
    key_missing: { status: 412, code: 'EMBEDDING_KEY_MISSING' },
    key_rejected: { status: 412, code: 'EMBEDDING_KEY_REJECTED' },
    provider: { status: 502, code: 'EMBEDDING_PROVIDER_UNAVAILABLE' },
};

/** 실패 사유를 AppError 로 — message 는 해석기·provider 문구(provider id·모델명만, 키 없음) */
export function embeddingAppError(reason: EmbeddingFailureReason, message: string): AppError {
    const http = REASON_HTTP[reason];
    return new AppError(message, http.status, true, http.code);
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
