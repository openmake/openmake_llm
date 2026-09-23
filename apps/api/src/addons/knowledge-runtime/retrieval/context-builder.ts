/**
 * 컨텍스트 블록 조립 — 게이트·topK 를 통과한 히트를 근거 블록으로 만들고, 같은 순서로 출처를 매긴다.
 * 인용 번호는 sourceOffset+1 부터 연속이며, 컨텍스트 예산(maxContextChars) 안에 실제로 들어간 히트만 출처가 된다
 * (블록에 없는 번호가 출처에 남지 않도록 둘을 함께 만든다).
 *
 * @module addons/knowledge-runtime/retrieval/context-builder
 */
import type { SearchSourceRef } from '../../../tools/web-search/types';
import { EVIDENCE_TAG, knowledgeInstructions } from '../prompts';
import { buildSource, excerpt, pageLabel } from './citation';
import type { SearchHit } from './search';

export interface BuiltContext {
    contextBlock: string;
    sources: SearchSourceRef[];
}

export interface BuildContextInput {
    hits: SearchHit[];
    sourceOffset: number;
    userLang: string;
    maxContextChars: number;
}

/** 근거 블록 + 출처. 예산 초과 시 이미 넣은 게 있으면 멈춘다(적어도 1건은 넣는다) */
export function buildKnowledgeContext(input: BuildContextInput): BuiltContext {
    const entries: string[] = [];
    const sources: SearchSourceRef[] = [];
    let used = 0;
    for (const hit of input.hits) {
        const n = input.sourceOffset + sources.length + 1;
        const pl = pageLabel(hit);
        const header = pl ? `[${n}] ${hit.documentName} (${pl})` : `[${n}] ${hit.documentName}`;
        const entry = `${header}\n${excerpt(hit.content)}`;
        if (used + entry.length > input.maxContextChars && sources.length > 0) break;
        entries.push(entry);
        sources.push(buildSource(hit, n));
        used += entry.length;
    }
    const evidence = `<${EVIDENCE_TAG}>\n${entries.join('\n\n')}\n</${EVIDENCE_TAG}>`;
    const contextBlock = `${knowledgeInstructions(input.userLang)}\n\n${evidence}`;
    return { contextBlock, sources };
}
