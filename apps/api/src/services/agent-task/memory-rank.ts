/**
 * 에이전트 작업의 메모리 주입 순서 — 관련도 × 신뢰도 × 시간 감쇠.
 * user_memories 에는 임베딩이 없어 관련도는 목표와의 키워드 겹침으로 잰다(교훈 매칭과 같은 토큰화).
 * 순수 모듈이다 — 조회·토큰 상한은 chat-service/user-context-blocks 가 그대로 맡는다.
 *
 * @module services/agent-task/memory-rank
 */
import { tokenizeGoal } from './tool-selector';
import { MEMORY_CONFIDENCE_BY_SOURCE } from '../../config/memory-metadata';
import { MEMORY_RANKING } from '../../config/agent-task-skill-memory';

interface RankableMemory {
    content: string;
    source: 'explicit' | 'candidate' | 'batch';
    confidence: number | null;
    created_at: string | Date;
}

interface RankConfig {
    relevanceFloor: number;
    halfLifeDays: number;
}

const DEFAULT_CONFIG: RankConfig = { relevanceFloor: MEMORY_RANKING.RELEVANCE_FLOOR, halfLifeDays: MEMORY_RANKING.HALF_LIFE_DAYS };
const DAY_MS = 24 * 60 * 60 * 1000;

/** PURE: 메모리 낱말 중 목표의 낱말과 겹치는 비율(0~1). 조사가 붙은 낱말도 맞게 한쪽이 다른 쪽을 포함하면 겹침으로 본다. */
export function memoryRelevance(goal: string, content: string): number {
    const goalTokens = tokenizeGoal(goal);
    const memTokens = tokenizeGoal(content);
    if (goalTokens.length === 0 || memTokens.length === 0) return 0;
    const hits = memTokens.filter((m) => goalTokens.some((g) => g.includes(m) || m.includes(g))).length;
    return hits / memTokens.length;
}

/** PURE: 점수 내림차순으로 정렬한 사본(동점은 입력 순서 = 최신순 유지). */
export function rankMemoriesForGoal<T extends RankableMemory>(goal: string, memories: readonly T[], now: Date = new Date(), cfg: RankConfig = DEFAULT_CONFIG): T[] {
    const score = (m: T): number => {
        const confidence = m.confidence ?? MEMORY_CONFIDENCE_BY_SOURCE[m.source] ?? 1;
        const ageDays = Math.max(0, (now.getTime() - new Date(m.created_at).getTime()) / DAY_MS);
        const decay = cfg.halfLifeDays > 0 ? Math.pow(0.5, ageDays / cfg.halfLifeDays) : 1;
        return (cfg.relevanceFloor + memoryRelevance(goal, m.content)) * confidence * decay;
    };
    return memories
        .map((m, i) => ({ m, i, s: score(m) }))
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .map((x) => x.m);
}
