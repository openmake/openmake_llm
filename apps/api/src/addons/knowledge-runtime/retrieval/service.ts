/**
 * 검색 서비스 — 질의 임베딩 → 인가 우선 벡터 검색 → 근거 게이트(유사도) → topK → 컨텍스트 예산.
 * 근거가 없으면 "관련 자료 없음" 블록만 돌려준다(모델이 없다고 말하게, 출처 0).
 *
 * @module addons/knowledge-runtime/retrieval/service
 */
import type { KnowledgeActor } from '../config/scope-policy';
import { applyRetrievalOverride, resolveSpaceProfiles } from '../config/profiles';
import { getActiveIndex, type KnowledgeIndex } from '../embedding/index-manager';
import { makeIndexEmbedder, type EmbedFn } from '../embedding/provider';
import { knowledgeNoEvidenceBlock } from '../prompts';
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
}

export interface RetrieveDeps {
    embed?: EmbedFn;
    getActiveIndex?: () => Promise<KnowledgeIndex | null>;
}

export async function retrieve(params: RetrieveParams, deps: RetrieveDeps = {}): Promise<RetrieveResult> {
    const activeIndex = deps.getActiveIndex ?? getActiveIndex;
    const noEvidence: RetrieveResult = { contextBlock: knowledgeNoEvidenceBlock(params.userLang), sources: [], hadEvidence: false };

    const index = await activeIndex();
    if (!index || params.spaceIds.length === 0) return noEvidence;

    // 질의 임베딩은 라이브 배정이 아니라 **활성 index 에 기록된 모델**로 한다(배정이 바뀌어도 index 와 같은 벡터 공간).
    const embed = deps.embed ?? makeIndexEmbedder(index);
    const profiles = await resolveSpaceProfiles(params.configProfileId);
    const retrieval = applyRetrievalOverride(profiles.retrieval, params.override);

    const [queryVector] = await embed([params.query]);
    if (!queryVector) return noEvidence;

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
