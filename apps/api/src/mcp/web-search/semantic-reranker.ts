/**
 * 웹검색 의미(semantic) 리랭킹 — bge-m3 임베딩 기반.
 *
 * 현재 랭킹은 term-match(쿼리 단어 문자열 포함) + 도메인 신뢰도 블렌드라, 동의어·의역 소스를
 * 놓치고 무관 소스를 통과시키는 한계가 있다. 이 모듈은 쿼리와 각 소스(제목+스니펫)의 bge-m3
 * 임베딩 코사인 유사도로 재정렬한다.
 *
 * measure-first: 우선 **셰도우 모드**(실행 무변경, 재정렬 결과만 로깅)로 기존 랭킹 대비 개선폭을
 * 측정한 뒤 활성화한다. `SEARCH_SEMANTIC_RERANK_SHADOW=true` 일 때만 fire-and-forget 로 호출.
 *
 * @module mcp/web-search/semantic-reranker
 */
import OpenAI from 'openai';
import { getConfig } from '../../config/env';
import { createLogger } from '../../utils/logger';
import type { SearchResult } from './types';

const logger = createLogger('RerankShadow');

/** 상위 몇 개 소스까지 임베딩할지 (비용·지연 상한). */
const SHADOW_TOP_N = 12;
/** 임베딩 입력 소스 텍스트 최대 길이(코드 포인트). */
const SHADOW_TEXT_CHARS = 512;
/** 실제 리랭킹 임베딩 호출 타임아웃(ms) — 초과 시 기존 랭킹 유지. env: SEARCH_RERANK_TIMEOUT_MS. */
const RERANK_TIMEOUT_MS = Number(process.env.SEARCH_RERANK_TIMEOUT_MS) || 2500;

async function embedBatch(texts: string[], model: string, baseURL: string, apiKey: string): Promise<number[][]> {
    const client = new OpenAI({ baseURL, apiKey });
    const res = await client.embeddings.create({ model, input: texts });
    return res.data.map((d) => d.embedding as number[]);
}

function cosine(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
}

function host(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url.slice(0, 24); }
}

/**
 * 의미 리랭킹 셰도우 — 기존(term/reliability) 랭킹 대비 임베딩 리랭킹 순서를 비교 로깅한다.
 * 실행은 바꾸지 않는다. 실패는 삼킨다(채팅 흐름 영향 0).
 *
 * @param query - 검색 쿼리
 * @param results - 기존 랭킹이 적용된 결과(점수 내림차순)
 */
export async function logSemanticRerankShadow(query: string, results: SearchResult[]): Promise<void> {
    if (results.length < 3) return;
    const cfg = getConfig();
    const top = results.slice(0, SHADOW_TOP_N);
    const texts = [query, ...top.map((r) => [...`${r.title} ${r.snippet || ''}`].slice(0, SHADOW_TEXT_CHARS).join(''))];

    let embs: number[][];
    const embStart = Date.now();
    try {
        embs = await embedBatch(texts, cfg.searchRerankEmbedModel, cfg.llmBaseUrl, cfg.llmApiKey);
    } catch (e) {
        logger.warn(`임베딩 실패(셰도우 skip): ${e instanceof Error ? e.message : String(e)}`);
        return;
    }
    // 활성화(ENABLED) 시 이 만큼이 웹검색 critical-path 에 더해진다 — 운영 셰도우로 실지연 관측용.
    const embMs = Date.now() - embStart;
    if (embs.length !== texts.length) return;

    const qv = embs[0];
    const scored = top.map((r, i) => ({ r, sim: cosine(qv, embs[i + 1]), origIdx: i }));
    const reranked = [...scored].sort((a, b) => b.sim - a.sim);

    const origTop = top.slice(0, 5).map((r) => host(r.url));
    const semanticTop = reranked.slice(0, 5).map((s) => host(s.r.url));
    const sims = scored.map((s) => s.sim);
    const simMin = Math.min(...sims).toFixed(2);
    const simMax = Math.max(...sims).toFixed(2);
    // 의미 top5 중 기존 랭킹에선 5위 밖(=term-match 가 놓쳤을) 소스 수 — 리랭킹 이득 신호.
    const liftedIntoTop5 = reranked.slice(0, 5).filter((s) => s.origIdx >= 5).length;
    // 기존 top5 중 의미 유사도 하위(무관 의심)로 밀린 소스 수.
    const rerankSet = new Set(reranked.slice(0, 5).map((s) => s.r.url));
    const demotedFromTop5 = top.slice(0, 5).filter((r) => !rerankSet.has(r.url)).length;

    logger.info(
        `q="${query.slice(0, 30)}" embMs=${embMs} n=${top.length} orig5=[${origTop.join(', ')}] ` +
        `semantic5=[${semanticTop.join(', ')}] sim=${simMin}~${simMax} lifted=${liftedIntoTop5} demoted=${demotedFromTop5}`,
    );
}

/**
 * 의미 리랭킹 실제 적용 — 상위 SHADOW_TOP_N 개 소스를 bge-m3 임베딩 코사인 유사도로 재정렬한다.
 * 임베딩 실패/타임아웃 시 기존 랭킹을 그대로 반환(graceful). 나머지(하위) 결과는 순서를 유지한다.
 *
 * @param query - 검색 쿼리
 * @param results - 기존 랭킹이 적용된 결과(점수 내림차순)
 * @returns 리랭킹된 결과 (실패 시 입력 그대로)
 */
export async function rerankBySemantics(query: string, results: SearchResult[]): Promise<SearchResult[]> {
    if (results.length < 3) return results;
    const cfg = getConfig();
    const top = results.slice(0, SHADOW_TOP_N);
    const rest = results.slice(SHADOW_TOP_N);
    const texts = [query, ...top.map((r) => [...`${r.title} ${r.snippet || ''}`].slice(0, SHADOW_TEXT_CHARS).join(''))];

    let embs: number[][];
    try {
        embs = await Promise.race([
            embedBatch(texts, cfg.searchRerankEmbedModel, cfg.llmBaseUrl, cfg.llmApiKey),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('rerank timeout')), RERANK_TIMEOUT_MS)),
        ]);
    } catch (e) {
        logger.warn(`리랭킹 skip(기존 랭킹 유지): ${e instanceof Error ? e.message : String(e)}`);
        return results;
    }
    if (embs.length !== texts.length) return results;

    const qv = embs[0];
    const reranked = top
        .map((r, i) => ({ r, sim: cosine(qv, embs[i + 1]) }))
        .sort((a, b) => b.sim - a.sim)
        .map((s) => s.r);
    return [...reranked, ...rest];
}
