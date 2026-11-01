/**
 * 검색 서비스 — 질의 임베딩 → 인가 우선 벡터 검색 → 근거 게이트(유사도) → topK → 컨텍스트 예산.
 * 근거가 없으면 "관련 자료 없음" 블록만 돌려준다(모델이 없다고 말하게, 출처 0).
 * 질의 임베딩은 공간에 고정된 색인의 모델로, 검색한 사용자의 키로 한다. 키 문제는 "관련 자료 없음" 으로 위장하지 않고
 * "검색할 수 없었다" 안내 블록(출처 0)을 돌려준다. 429·5xx 는 throw — Base 가 이 통합만 건너뛴다(채팅은 계속).
 *
 * @module addons/knowledge-runtime/retrieval/service
 */
import type { KnowledgeActor } from '../config/scope-policy';
import { applyRetrievalOverride, resolveSpaceProfiles } from '../config/profiles';
import { getSpaceIndex, type KnowledgeIndex } from '../embedding/index-catalog';
import { classifyEmbedError, makeIndexEmbedder, type EmbedFn, type EmbeddingFailureReason } from '../embedding/provider';
import { knowledgeEmbeddingUnavailableBlock, knowledgeNoEvidenceBlock } from '../prompts';
import { buildKnowledgeContext, type BuiltContext } from './context-builder';
import { searchChunks } from './search';

export interface RetrieveParams {
    actor: KnowledgeActor;
    /** 검색 범위 — 채팅은 연결된 한 Space 만 */
    spaceIds: string[];
    query: string;
    /** 출처 번호 시작 오프셋(앞선 웹검색 출처 뒤) */
    sourceOffset: number;
    userLang: string;
    /** Space 의 config 프로필(청커·검색·한도 해석용) */
    configProfileId?: string | null;
    /** 허용된 요청 오버라이드(topK 등) */
    override?: { topK?: unknown };
}

export interface RetrieveResult extends BuiltContext {
    hadEvidence: boolean;
    /** 질의 임베딩을 못 한 이유(키 누락·거절) — 있으면 contextBlock 은 "검색할 수 없었다" 안내다 */
    unavailableReason?: EmbeddingFailureReason;
}

export interface RetrieveDeps {
    embed?: EmbedFn;
    getSpaceIndex?: (spaceId: string) => Promise<KnowledgeIndex | null>;
}

/** fullId 의 provider id(안내 문구용 — 카탈로그 id) */
function providerOf(providerRef: string): string {
    const i = providerRef.indexOf(':');
    return i > 0 ? providerRef.slice(0, i) : providerRef;
}

export async function retrieve(params: RetrieveParams, deps: RetrieveDeps = {}): Promise<RetrieveResult> {
    const spaceIndexOf = deps.getSpaceIndex ?? getSpaceIndex;
    const noEvidence: RetrieveResult = { contextBlock: knowledgeNoEvidenceBlock(params.userLang), sources: [], hadEvidence: false };
    if (params.spaceIds.length === 0) return noEvidence;

    // 질의 벡터는 하나다 — 여러 공간이면 모두 같은 색인이어야 한다(지금 호출부는 한 공간만 넘긴다, 방어)
    const indexes = await Promise.all(params.spaceIds.map((id) => spaceIndexOf(id)));
    const index = indexes[0];
    if (indexes.some((i) => (i?.id ?? null) !== (index?.id ?? null))) {
        throw new Error('서로 다른 임베딩 색인의 공간을 한 질의로 검색할 수 없습니다');
    }
    if (!index) return noEvidence; // 색인이 아직 없는 새 공간 — 검색할 문서가 없다

    // 질의 임베딩은 라이브 배정이 아니라 **공간 색인에 기록된 모델**로, 검색한 사용자의 키로 한다
    const embed = deps.embed ?? makeIndexEmbedder(index, { userId: params.actor.userId }, { spaceId: params.spaceIds[0] });
    let queryVector: number[] | undefined;
    try {
        [queryVector] = await embed([params.query]);
    } catch (err) {
        const reason = classifyEmbedError(err);
        if (reason === 'provider') throw err;
        return {
            contextBlock: knowledgeEmbeddingUnavailableBlock(params.userLang, reason, providerOf(index.providerRef)),
            sources: [], hadEvidence: false, unavailableReason: reason,
        };
    }
    if (!queryVector) return noEvidence;

    const profiles = await resolveSpaceProfiles(params.configProfileId);
    const retrieval = applyRetrievalOverride(profiles.retrieval, params.override);
    const hits = await searchChunks({
        actor: params.actor, spaceIds: params.spaceIds, queryVector,
        candidateCount: retrieval.candidateCount, index,
    });
    // 근거 게이트(유사도) → topK
    const gated = hits.filter((h) => h.similarity >= retrieval.minSimilarity).slice(0, retrieval.topK);
    if (gated.length === 0) return noEvidence;

    const built = buildKnowledgeContext({
        hits: gated, sourceOffset: params.sourceOffset, userLang: params.userLang, maxContextChars: retrieval.maxContextChars,
    });
    return { ...built, hadEvidence: true };
}
