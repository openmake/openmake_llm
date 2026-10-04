/**
 * 에이전트 작업의 메모리 주입 순서 — 관련도 × 신뢰도 × 시간 감쇠.
 * user_memories 에는 임베딩이 없어 관련도는 목표와의 키워드 겹침으로 잰다 — 한글 조사·어미와 기능어를 정리한 낱말로 비교한다.
 * 순수 모듈이다 — 조회·토큰 상한은 chat-service/user-context-blocks 가 그대로 맡는다.
 *
 * @module services/agent-task/memory-rank
 */
import { MEMORY_CONFIDENCE_BY_SOURCE } from '../../config/memory-metadata';
import { MEMORY_RANKING, MEMORY_RANK_KOREAN_SUFFIXES, MEMORY_RANK_STOPWORDS } from '../../config/agent-task-skill-memory';

interface RankableMemory {
    content: string;
    source: 'explicit' | 'candidate' | 'batch';
    confidence: number | null;
    created_at: string | Date;
}

interface RankConfig {
    relevanceFloor: number;
    halfLifeDays: number;
    /** 미지정이면 MEMORY_RANKING.MATCH_FIRST. */
    matchFirst?: boolean;
}

const DEFAULT_CONFIG: RankConfig = { relevanceFloor: MEMORY_RANKING.RELEVANCE_FLOOR, halfLifeDays: MEMORY_RANKING.HALF_LIFE_DAYS };
const DAY_MS = 24 * 60 * 60 * 1000;

const HANGUL_RE = /[가-힣]/;

/** PURE: 한글 낱말 끝의 조사·어미를 하나 뗀다 — 어간이 두 글자 미만이 되면 그대로 둔다. */
function stripKoreanSuffix(word: string): string {
    const suffix = MEMORY_RANK_KOREAN_SUFFIXES.find((sfx) => word.endsWith(sfx) && word.length - sfx.length >= 2);
    return suffix ? word.slice(0, -suffix.length) : word;
}

/** PURE: 영어 낱말의 복수형 s 를 뗀다("meetings" → "meeting"). */
function stripPlural(word: string): string {
    return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

/** PURE: 관련도 비교용 낱말 — 소문자, 조사·어미·복수형 정리, 두 글자 이상, 기능어 제외, 중복 제거. */
export function memoryTokens(text: string): string[] {
    const out = new Set<string>();
    for (const raw of text.toLowerCase().split(/[^a-z0-9가-힣]+/)) {
        const word = HANGUL_RE.test(raw) ? stripKoreanSuffix(raw) : stripPlural(raw);
        if (word.length >= 2 && !MEMORY_RANK_STOPWORDS.has(word)) out.add(word);
    }
    return [...out];
}

/** PURE: 두 낱말이 겹치는가 — 한글은 한쪽이 다른 쪽을 포함하면(합성어), 영문·숫자는 같아야 한다("to" 가 "tokyo" 에 걸리지 않게). */
function tokensOverlap(a: string, b: string): boolean {
    return a === b || (HANGUL_RE.test(a) && HANGUL_RE.test(b) && (a.includes(b) || b.includes(a)));
}

/** PURE: 메모리 낱말 중 목표의 낱말과 겹치는 비율(0~1). */
export function memoryRelevance(goal: string, content: string): number {
    const goalTokens = memoryTokens(goal);
    const memTokens = memoryTokens(content);
    if (goalTokens.length === 0 || memTokens.length === 0) return 0;
    const hits = memTokens.filter((m) => goalTokens.some((g) => tokensOverlap(g, m))).length;
    return hits / memTokens.length;
}

/**
 * PURE: 순위대로 정렬한 사본. 목표와 겹치는 메모리가 먼저(matchFirst), 그 안에서는 점수 내림차순,
 * 동점은 입력 순서(= 최신순)를 유지한다.
 */
export function rankMemoriesForGoal<T extends RankableMemory>(goal: string, memories: readonly T[], now: Date = new Date(), cfg: RankConfig = DEFAULT_CONFIG): T[] {
    const matchFirst = cfg.matchFirst ?? MEMORY_RANKING.MATCH_FIRST;
    const scored = memories.map((m, i) => {
        const relevance = memoryRelevance(goal, m.content);
        const confidence = m.confidence ?? MEMORY_CONFIDENCE_BY_SOURCE[m.source] ?? 1;
        const ageDays = Math.max(0, (now.getTime() - new Date(m.created_at).getTime()) / DAY_MS);
        const decay = cfg.halfLifeDays > 0 ? Math.pow(0.5, ageDays / cfg.halfLifeDays) : 1;
        return { m, i, matched: matchFirst && relevance > 0 ? 1 : 0, s: (cfg.relevanceFloor + relevance) * confidence * decay };
    });
    return scored
        .sort((a, b) => b.matched - a.matched || b.s - a.s || a.i - b.i)
        .map((x) => x.m);
}
