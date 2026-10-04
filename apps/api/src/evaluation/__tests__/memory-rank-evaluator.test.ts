/**
 * 메모리 주입 순서 평가 — 골든 묶음에서 순위 방식이 최신순보다 정답을 더 싣는지 본다.
 * 채점기 자체의 검증을 겸한다: 순위를 거꾸로 매기면 recall 이 떨어져야 한다.
 */
import { loadMemoryRankGolden, runMemoryRankGolden, MEMORY_RANK_CAP_RATIOS } from '../memory-rank-evaluator';
import { rankMemoriesForGoal } from '../../services/agent-task/memory-rank';
import { USER_CONTEXT_LIMITS } from '../../config/runtime-limits';

const golden = loadMemoryRankGolden();
const caps = MEMORY_RANK_CAP_RATIOS.map((r) => Math.floor(USER_CONTEXT_LIMITS.MAX_MEMORY_TOKENS * r));

describe('골든 묶음', () => {
    it('메모리 60건 이상, 목표 20개, 한국어·영어가 섞여 있다', () => {
        expect(golden.memories.length).toBeGreaterThanOrEqual(60);
        expect(golden.goals.length).toBe(20);
        expect(golden.memories.some((m) => /[가-힣]/.test(m.content))).toBe(true);
        expect(golden.memories.some((m) => !/[가-힣]/.test(m.content))).toBe(true);
    });

    it.each(caps)('상한 %d토큰 — 순위 방식의 recall 이 최신순보다 높고, 최신순이 이기는 목표는 드물다', (maxTokens) => {
        const s = runMemoryRankGolden(golden, { maxTokens });
        expect(s.recall.ranked).toBeGreaterThan(s.recall.recency);
        expect(s.alwaysRecall.ranked).toBeGreaterThanOrEqual(s.alwaysRecall.recency);
        expect(s.wins).toBeGreaterThan(s.losses * 2);
        expect(s.losses).toBeLessThanOrEqual(golden.goals.length * 0.2);
    });

    it('상한이 실제로 자르는 조건이 있다(없으면 순위가 아니라 읽는 건수만 재게 된다)', () => {
        const tight = runMemoryRankGolden(golden, { maxTokens: caps[caps.length - 1] });
        expect(tight.injected.ranked).toBeLessThan(golden.memories.length / 2);
    });
});

describe('채점기', () => {
    it('순위를 거꾸로 매기면 recall 이 떨어진다', () => {
        const maxTokens = caps[caps.length - 1];
        const good = runMemoryRankGolden(golden, { maxTokens });
        const bad = runMemoryRankGolden(golden, { maxTokens, rank: (goal, ms, now) => rankMemoriesForGoal(goal, ms, now).reverse() });
        expect(bad.recall.ranked).toBeLessThan(good.recall.ranked);
    });

    it('없는 메모리 id 를 정답으로 단 묶음은 읽을 때 거부한다', () => {
        const fs = require('fs') as typeof import('fs');
        const os = require('os') as typeof import('os');
        const path = require('path') as typeof import('path');
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'memrank-')), 'g.json');
        fs.writeFileSync(file, JSON.stringify({ ...golden, goals: [{ id: 'g', goal: '목표', expected: ['없는-id'] }] }));
        expect(() => loadMemoryRankGolden(file)).toThrow(/없는 메모리 id/);
    });
});
