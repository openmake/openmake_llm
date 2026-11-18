/**
 * 웹검색 의미(semantic) 리랭킹 — `text.embed` 배정 모델 임베딩 기반.
 *
 * 현재 랭킹은 term-match(쿼리 단어 문자열 포함) + 도메인 신뢰도 블렌드라, 동의어·의역 소스를
 * 놓치고 무관 소스를 통과시키는 한계가 있다. 이 모듈은 쿼리와 각 소스(제목+스니펫)의 `text.embed`
 * 배정 모델(행위자 개인 → 전역, 외부 모델은 행위자 키) 임베딩 코사인 유사도로 재정렬한다.
 * 미배정·키 없음·실패는 기존 랭킹 유지(셰도우는 건너뜀).
 *
 * measure-first: 우선 **셰도우 모드**(실행 무변경, 재정렬 결과만 로깅)로 기존 랭킹 대비 개선폭을
 * 측정한 뒤 활성화한다. `SEARCH_SEMANTIC_RERANK_SHADOW=true` 일 때만 fire-and-forget 로 호출.
 *
 * @module mcp/web-search/semantic-reranker
 */
import { createLogger } from '../../utils/logger';
import { recordCost } from '../../services/cost/cost-ledger-service';
import { resolveTextEmbed, embedTexts, logTextEmbedFailure, type TextEmbedTarget } from '../../services/orchestrator/text-embed';
import type { SearchResult } from './types';

const logger = createLogger('RerankShadow');

/** 상위 몇 개 소스까지 임베딩할지 (비용·지연 상한). */
const SHADOW_TOP_N = 12;
/** 임베딩 입력 소스 텍스트 최대 길이(코드 포인트). */
const SHADOW_TEXT_CHARS = 512;
/** 실제 리랭킹 임베딩 호출 타임아웃(ms) — 초과 시 기존 랭킹 유지. env: SEARCH_RERANK_TIMEOUT_MS. */
const RERANK_TIMEOUT_MS = Number(process.env.SEARCH_RERANK_TIMEOUT_MS) || 2500;

/**
 * 행위자 배정으로 해석해 한 번 임베딩한다. 재시도 없음.
 * 기한 하나가 해석(DB 조회·키 복호화)부터 임베딩까지 덮는다 — 지나면 공유 신호로 진행 중 요청이 끊기고(callJson) throw.
 */
async function embedForRerank(texts: string[], costUserId: string | undefined): Promise<{ te: TextEmbedTarget; embs: number[][] }> {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => {
            const err = new Error(`리랭킹 임베딩 타임아웃(${RERANK_TIMEOUT_MS}ms)`);
            ac.abort(err);
            rej(err);
        }, RERANK_TIMEOUT_MS);
        timer.unref?.();
    });
    const work = (async () => {
        const te = await resolveTextEmbed(costUserId);
        ac.signal.throwIfAborted(); // 해석이 기한 뒤에 끝났으면 호출하지 않는다
        return { te, embs: await embedTexts(te, texts, { timeoutMs: RERANK_TIMEOUT_MS, signal: ac.signal }) };
    })();
    work.catch(() => undefined); // 기한 초과 뒤의 늦은 실패는 race 가 이미 처리했다
    try {
        return await Promise.race([work, timeout]);
    } finally {
        clearTimeout(timer);
    }
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

/** 임베딩 호출 1건 원장 적재(kind search.rerank, unit call — F25 kind 배선, S6). costUserId 없으면 생략. 사용자 키 대상이면 byok. */
function recordRerankCost(costUserId: string | undefined, te: TextEmbedTarget): void {
    if (!costUserId) return;
    recordCost({ userId: costUserId, kind: 'search.rerank', unit: 'call', rateKey: te.target.model, quantity: 1, costOwner: te.target.costOwner === 'user' ? 'byok' : 'user', ctx: { feature: 'web_search_rerank' } });
}

/**
 * 의미 리랭킹 셰도우 — 기존(term/reliability) 랭킹 대비 임베딩 리랭킹 순서를 비교 로깅한다.
 * 실행은 바꾸지 않는다. 실패는 삼킨다(채팅 흐름 영향 0).
 *
 * @param query - 검색 쿼리
 * @param results - 기존 랭킹이 적용된 결과(점수 내림차순)
 * @param costUserId - 원장 귀속 사용자(F25 PR-4, S6)이자 임베딩 행위자(text.embed 개인 배정·BYOK 의 주인) — 있으면 search.rerank 1건 기록
 */
export async function logSemanticRerankShadow(query: string, results: SearchResult[], costUserId?: string): Promise<void> {
    if (results.length < 3) return;
    const top = results.slice(0, SHADOW_TOP_N);
    const texts = [query, ...top.map((r) => [...`${r.title} ${r.snippet || ''}`].slice(0, SHADOW_TEXT_CHARS).join(''))];

    let embs: number[][];
    const embStart = Date.now();
    try {
        const r = await embedForRerank(texts, costUserId);
        embs = r.embs;
        recordRerankCost(costUserId, r.te);
    } catch (e) {
        logTextEmbedFailure(logger, '임베딩 실패(셰도우 skip)', e);
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
 * 의미 리랭킹 실제 적용 — 상위 SHADOW_TOP_N 개 소스를 `text.embed` 배정 모델 임베딩 코사인 유사도로 재정렬한다.
 * 임베딩 실패/타임아웃 시 기존 랭킹을 그대로 반환(graceful). 나머지(하위) 결과는 순서를 유지한다.
 *
 * @param query - 검색 쿼리
 * @param results - 기존 랭킹이 적용된 결과(점수 내림차순)
 * @param costUserId - 원장 귀속 사용자(F25 PR-4, S6)이자 임베딩 행위자(text.embed 개인 배정·BYOK 의 주인) — 있으면 search.rerank 1건 기록
 * @returns 리랭킹된 결과 (실패 시 입력 그대로)
 */
export async function rerankBySemantics(query: string, results: SearchResult[], costUserId?: string): Promise<SearchResult[]> {
    if (results.length < 3) return results;
    const top = results.slice(0, SHADOW_TOP_N);
    const rest = results.slice(SHADOW_TOP_N);
    const texts = [query, ...top.map((r) => [...`${r.title} ${r.snippet || ''}`].slice(0, SHADOW_TEXT_CHARS).join(''))];

    let embs: number[][];
    try {
        const r = await embedForRerank(texts, costUserId);
        embs = r.embs;
        recordRerankCost(costUserId, r.te);
    } catch (e) {
        logTextEmbedFailure(logger, '리랭킹 skip(기존 랭킹 유지)', e);
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
