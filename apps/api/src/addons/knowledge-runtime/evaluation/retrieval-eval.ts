/**
 * K08 검색 수준 평가 — 실 임베딩(bge-m3, 게이트웨이)으로 인가 우선 검색을 측정한다.
 * 게이트 지표: 미인가 검색 0 · 삭제 문서 검색 0 · 인용 무결 100% · 근거 게이트(비답변)·Recall@5.
 * 각 케이스의 검색 산출물(contextBlock·sources)은 --real-llm 재사용을 위해 캐시한다.
 *
 * @module addons/knowledge-runtime/evaluation/retrieval-eval
 */
import type { SearchSourceRef } from '../../../tools/web-search/types';
import { EVIDENCE_TAG } from '../prompts';
import { actorFor } from '../config/scope-policy';
import { retrieve } from '../retrieval/service';
import { resolveBoundSpace } from '../conversations/binding-service';
import { deleteDocument } from '../documents/service';
import { deleteSpace } from '../spaces/service';
import type { EvalCase, EvalDataset } from './types';
import type { SeedContext } from './seeding';
import { recallAtK, citationIntegrity, round4 } from './metrics';

/** 케이스별 검색 결과(캐시·리포트용) */
export interface CaseRetrieval {
    caseId: string;
    category: string;
    hadEvidence: boolean;
    sources: SearchSourceRef[];
    contextBlock: string;
    returnedDocKeys: string[];
    recallAt5: number | null;
    citationMismatch: number;
    /** 이 케이스에서 관측된 미인가/삭제 문서 검색 히트 수 */
    unauthorizedHits: number;
    deletedHits: number;
    /** injection 케이스: 인젝션 문서가 실제 검색됐는가 */
    injectionRetrieved: boolean | null;
    query?: string;
    injectionDocKey?: string;
}

export interface RetrievalEvalResult {
    perCase: CaseRetrieval[];
    counters: {
        unauthorizedRetrieval: number;
        deletedDocRetrieval: number;
        citationIntegrityMismatch: number;
        recallSamples: number[];
        noAnswerHandled: number;
        noAnswerTotal: number;
        injectionRetrievedSamples: boolean[];
    };
}

const DOC_RE = /[?&]doc=([^&]+)/;

function docKeyFromSource(src: SearchSourceRef, docIdToKey: Map<string, string>): string | undefined {
    const m = DOC_RE.exec(src.url ?? '');
    if (!m) return undefined;
    return docIdToKey.get(decodeURIComponent(m[1]));
}

async function runRetrieve(
    personaId: string, spaceId: string, query: string, docIdToKey: Map<string, string>,
): Promise<{ hadEvidence: boolean; sources: SearchSourceRef[]; contextBlock: string; returnedDocKeys: string[] }> {
    const actor = await actorFor(personaId);
    const r = await retrieve({ actor, spaceIds: [spaceId], query, sourceOffset: 0, userLang: 'ko' });
    const returnedDocKeys = r.sources.map((s) => docKeyFromSource(s, docIdToKey)).filter((k): k is string => !!k);
    return { hadEvidence: r.hadEvidence, sources: r.sources, contextBlock: r.contextBlock, returnedDocKeys };
}

/** 근거 케이스(answerable·comparison·conflict·injection) 측정 */
async function evalGrounded(
    c: EvalCase, seed: SeedContext, docIdToKey: Map<string, string>,
): Promise<CaseRetrieval> {
    const personaId = seed.personaIds[c.asPersona!];
    const spaceId = seed.spaceIds[c.spaceKey!];
    const r = await runRetrieve(personaId, spaceId, c.query!, docIdToKey);
    const gold = c.goldDocKeys ?? [];
    const recall = gold.length > 0 ? recallAtK(gold, r.returnedDocKeys, 5) : null;
    const integ = citationIntegrity(r.contextBlock, r.sources.map((s) => s.n), EVIDENCE_TAG);
    const injectionRetrieved = c.injectionDocKey ? r.returnedDocKeys.includes(c.injectionDocKey) : null;
    return {
        caseId: c.id, category: c.category, hadEvidence: r.hadEvidence, sources: r.sources, contextBlock: r.contextBlock,
        returnedDocKeys: r.returnedDocKeys, recallAt5: recall === null ? null : round4(recall),
        citationMismatch: integ.mismatch, unauthorizedHits: 0, deletedHits: 0, injectionRetrieved,
        query: c.query, injectionDocKey: c.injectionDocKey,
    };
}

/** 비답변 케이스 — 근거 없음이어야 한다 */
async function evalUnanswerable(c: EvalCase, seed: SeedContext, docIdToKey: Map<string, string>): Promise<CaseRetrieval> {
    const r = await runRetrieve(seed.personaIds[c.asPersona!], seed.spaceIds[c.spaceKey!], c.query!, docIdToKey);
    const integ = citationIntegrity(r.contextBlock, r.sources.map((s) => s.n), EVIDENCE_TAG);
    return {
        caseId: c.id, category: c.category, hadEvidence: r.hadEvidence, sources: r.sources, contextBlock: r.contextBlock,
        returnedDocKeys: r.returnedDocKeys, recallAt5: null, citationMismatch: integ.mismatch,
        unauthorizedHits: 0, deletedHits: 0, injectionRetrieved: null, query: c.query,
    };
}

/** 권한 공격 — 미인가 검색/바인딩 해석은 전부 비노출이어야 한다 */
async function evalAuthorization(c: EvalCase, seed: SeedContext, docIdToKey: Map<string, string>): Promise<CaseRetrieval> {
    const attackerId = seed.personaIds[c.asPersona!];
    let unauthorizedHits = 0;
    let sources: SearchSourceRef[] = [];
    let contextBlock = '';
    if (c.authKind === 'other_user' || c.authKind === 'other_org') {
        const r = await runRetrieve(attackerId, seed.spaceIds[c.spaceKey!], c.query!, docIdToKey);
        unauthorizedHits = r.sources.length;
        sources = r.sources; contextBlock = r.contextBlock;
    } else if (c.authKind === 'forged_binding') {
        // 공격자가 남의 바인딩 세션을 해석 → null 이어야(누출 0). null 아니면 미인가.
        const bound = await resolveBoundSpace(attackerId, seed.boundSessionBySpace[c.spaceKey!]);
        unauthorizedHits = bound ? 1 : 0;
    } else {
        // unbound — 바인딩 없는 세션 → null 이어야
        const bound = await resolveBoundSpace(attackerId, seed.unboundSessionByPersona[c.asPersona!]);
        unauthorizedHits = bound ? 1 : 0;
    }
    return {
        caseId: c.id, category: c.category, hadEvidence: false, sources, contextBlock,
        returnedDocKeys: [], recallAt5: null, citationMismatch: 0, unauthorizedHits, deletedHits: 0,
        injectionRetrieved: null, query: c.query,
    };
}

/** 삭제 공격 — 삭제 문서/tombstone Space 는 검색되지 않아야 한다 */
async function evalDeletion(c: EvalCase, seed: SeedContext, docIdToKey: Map<string, string>): Promise<CaseRetrieval> {
    const personaId = seed.personaIds[c.asPersona!];
    const spaceId = seed.spaceIds[c.spaceKey!];
    const r = await runRetrieve(personaId, spaceId, c.query!, docIdToKey);
    let deletedHits = 0;
    if (c.deletionKind === 'deleted_document') {
        deletedHits = r.returnedDocKeys.filter((k) => k === 'alpha-delete').length;
    } else {
        // tombstoned space — 그 Space 에서 온 어떤 히트도 있으면 안 된다
        deletedHits = r.sources.length;
    }
    return {
        caseId: c.id, category: c.category, hadEvidence: r.hadEvidence, sources: r.sources, contextBlock: r.contextBlock,
        returnedDocKeys: r.returnedDocKeys, recallAt5: null, citationMismatch: 0, unauthorizedHits: 0,
        deletedHits, injectionRetrieved: null, query: c.query,
    };
}

export async function runRetrievalEval(dataset: EvalDataset, seed: SeedContext): Promise<RetrievalEvalResult> {
    const docIdToKey = new Map<string, string>();
    for (const [key, d] of Object.entries(seed.docs)) docIdToKey.set(d.documentId, key);

    const perCase: CaseRetrieval[] = [];
    const groundedCats = new Set(['answerable', 'comparison', 'conflict', 'injection']);

    // ① 읽기 전용 케이스(근거·비답변·권한) 먼저
    for (const c of dataset.cases) {
        if (groundedCats.has(c.category)) perCase.push(await evalGrounded(c, seed, docIdToKey));
        else if (c.category === 'unanswerable') perCase.push(await evalUnanswerable(c, seed, docIdToKey));
        else if (c.category === 'authorization') perCase.push(await evalAuthorization(c, seed, docIdToKey));
    }

    // ② 삭제 변이 적용(1회) — 삭제 문서 + doomed Space tombstone
    await deleteDocument(seed.personaIds.owner, seed.spaceIds.alpha, seed.docs['alpha-delete'].documentId);
    await deleteSpace(seed.personaIds.owner, seed.spaceIds.doomed);

    for (const c of dataset.cases) {
        if (c.category === 'deletion') perCase.push(await evalDeletion(c, seed, docIdToKey));
    }

    // 집계
    const counters = {
        unauthorizedRetrieval: 0, deletedDocRetrieval: 0, citationIntegrityMismatch: 0,
        recallSamples: [] as number[], noAnswerHandled: 0, noAnswerTotal: 0, injectionRetrievedSamples: [] as boolean[],
    };
    for (const r of perCase) {
        counters.unauthorizedRetrieval += r.unauthorizedHits;
        counters.deletedDocRetrieval += r.deletedHits;
        counters.citationIntegrityMismatch += r.citationMismatch;
        if (r.recallAt5 !== null) counters.recallSamples.push(r.recallAt5);
        if (r.category === 'unanswerable') {
            counters.noAnswerTotal += 1;
            if (!r.hadEvidence) counters.noAnswerHandled += 1;
        }
        if (r.injectionRetrieved !== null) counters.injectionRetrievedSamples.push(r.injectionRetrieved);
    }
    return { perCase, counters };
}
