/**
 * 메모리 주입 순서 평가 — 가상 사용자의 메모리 묶음과 작업 목표로, 토큰 상한 안에 "실려야 할 메모리"가
 * 실리는 비율(recall)을 최신순(종전)과 순위 방식(관련도 × 신뢰도 × 시간 감쇠)에서 비교한다. LLM·DB 를 쓰지 않는다.
 *
 * 두 방식 모두 운영 경로와 같은 함수를 쓴다: 최신순은 최근 RECENCY_POOL 건, 순위 방식은 최근 POOL_SIZE 건을
 * rankMemoriesForGoal 로 정렬한 뒤, 같은 토큰 상한(capMemoriesByTokens)으로 자른다.
 *
 * 정답(expected)은 사람 기준이다 — 낱말이 겹치지 않아도 내용상 필요하면 정답이고, 구현 출력에 맞춰 고치지 않는다.
 * always 메모리(응답 방식 선호)는 목표와 무관하게 실려야 하므로 따로 센다.
 *
 * @module evaluation/memory-rank-evaluator
 */
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { USER_CONTEXT_LIMITS } from '../config/runtime-limits';
import { MEMORY_RANKING } from '../config/agent-task-skill-memory';
import { rankMemoriesForGoal } from '../services/agent-task/memory-rank';
import { capMemoriesByTokens } from '../services/chat-service/user-context-blocks';

const memorySchema = z.object({
    id: z.string().min(1),
    content: z.string().min(1),
    source: z.enum(['explicit', 'candidate', 'batch']),
    confidence: z.number().min(0).max(1).nullable(),
    daysAgo: z.number().min(0),
    always: z.boolean().optional(),
}).strict();
const goalSchema = z.object({ id: z.string().min(1), goal: z.string().min(1), expected: z.array(z.string().min(1)).min(1) }).strict();
const goldenSchema = z.object({
    version: z.string(), description: z.string().optional(), now: z.string(),
    memories: z.array(memorySchema).min(1), goals: z.array(goalSchema).min(1),
}).strict();

export type MemoryRankGolden = z.infer<typeof goldenSchema>;

/** 최신순(종전) 경로가 읽는 건수 — buildUserMemoryBlock 의 기본값과 같다. */
const RECENCY_POOL = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 재는 토큰 상한 — 운영 상한(USER_CONTEXT_LIMITS.MAX_MEMORY_TOKENS)에 대한 비율. */
export const MEMORY_RANK_CAP_RATIOS = [1, 0.5, 0.25] as const;
const DEFAULT_GOLDEN = path.resolve(__dirname, 'golden-memory-rank.json');

export function loadMemoryRankGolden(filePath: string = DEFAULT_GOLDEN): MemoryRankGolden {
    const golden = goldenSchema.parse(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    const ids = new Set(golden.memories.map((m) => m.id));
    if (ids.size !== golden.memories.length) throw new Error('메모리 id 가 겹칩니다');
    for (const g of golden.goals) {
        const unknown = g.expected.filter((id) => !ids.has(id));
        if (unknown.length > 0) throw new Error(`${g.id}: 없는 메모리 id — ${unknown.join(', ')}`);
    }
    return golden;
}

export interface MemoryRankGoalResult {
    goalId: string;
    expected: number;
    recencyHit: string[];
    rankedHit: string[];
    /** 순위 방식이 놓친 정답. */
    rankedMissed: string[];
}

export interface MemoryRankSummary {
    version: string;
    maxTokens: number;
    /** 방식별 실린 메모리 수(목표 평균). */
    injected: { recency: number; ranked: number };
    /** 목표별 recall 의 평균. */
    recall: { recency: number; ranked: number };
    /** always 메모리가 실린 비율(목표 평균). */
    alwaysRecall: { recency: number; ranked: number };
    /** 목표 수 — 순위 방식이 더 많이 실음 / 같음 / 최신순이 더 많이 실음. */
    wins: number; ties: number; losses: number;
    goals: MemoryRankGoalResult[];
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** PURE: 골든 묶음을 두 방식으로 채점한다. */
export function runMemoryRankGolden(
    golden: MemoryRankGolden,
    opts: { maxTokens?: number; rank?: typeof rankMemoriesForGoal } = {},
): MemoryRankSummary {
    const maxTokens = opts.maxTokens ?? USER_CONTEXT_LIMITS.MAX_MEMORY_TOKENS;
    const rank = opts.rank ?? rankMemoriesForGoal;
    const now = new Date(golden.now);
    // 저장소가 주는 순서 — 최신순.
    const rows = golden.memories
        .map((m) => ({ id: m.id, content: m.content, source: m.source, confidence: m.confidence, created_at: new Date(now.getTime() - m.daysAgo * DAY_MS).toISOString() }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const always = golden.memories.filter((m) => m.always).map((m) => m.id);
    const recencyIds = new Set(capMemoriesByTokens(rows.slice(0, RECENCY_POOL), maxTokens).map((m) => m.id));
    const share = (ids: Set<string>, wanted: readonly string[]): number => (wanted.length ? wanted.filter((id) => ids.has(id)).length / wanted.length : 1);

    const injectedRanked: number[] = [];
    const alwaysRanked: number[] = [];
    const goals = golden.goals.map((g): MemoryRankGoalResult => {
        const ranked = capMemoriesByTokens(rank(g.goal, rows.slice(0, MEMORY_RANKING.POOL_SIZE), now), maxTokens);
        const rankedIds = new Set(ranked.map((m) => m.id));
        injectedRanked.push(ranked.length);
        alwaysRanked.push(share(rankedIds, always));
        return {
            goalId: g.id, expected: g.expected.length,
            recencyHit: g.expected.filter((id) => recencyIds.has(id)),
            rankedHit: g.expected.filter((id) => rankedIds.has(id)),
            rankedMissed: g.expected.filter((id) => !rankedIds.has(id)),
        };
    });
    return {
        version: golden.version, maxTokens,
        injected: { recency: recencyIds.size, ranked: mean(injectedRanked) },
        recall: { recency: mean(goals.map((g) => g.recencyHit.length / g.expected)), ranked: mean(goals.map((g) => g.rankedHit.length / g.expected)) },
        alwaysRecall: { recency: share(recencyIds, always), ranked: mean(alwaysRanked) },
        wins: goals.filter((g) => g.rankedHit.length > g.recencyHit.length).length,
        ties: goals.filter((g) => g.rankedHit.length === g.recencyHit.length).length,
        losses: goals.filter((g) => g.rankedHit.length < g.recencyHit.length).length,
        goals,
    };
}
