/**
 * 접기 뒤 회상 평가 — 긴 대화 각본을 접기·인계 요약에 통과시킨 뒤 사라진 구간의 사실이 남았는지 본다.
 * 채점기 자체의 검증을 겸한다: 남아야 할 사실이 없어지면 실패로 잡혀야 한다.
 */
import {
    loadCompactionGolden, runCompactionGolden, evaluateCompactionScenario, buildScenarioConversation,
    COMPACTION_POLICIES, type CompactionScenario,
} from '../compaction-recall-evaluator';

const golden = loadCompactionGolden();

describe('골든 각본', () => {
    it('모든 정책에서 "무엇을 했고 결과가 어땠나"는 전부 남는다', () => {
        const summary = runCompactionGolden(golden);
        expect(summary.failures).toEqual([]);
        expect(summary.policies.map((p) => p.policy)).toEqual([...COMPACTION_POLICIES]);
        for (const p of summary.policies) {
            expect(p.required.total).toBeGreaterThan(0);
            expect(p.required.kept).toBe(p.required.total);
        }
    });

    it('각본이 충분히 길다 — 정책마다 사라지는 구간이 있다(없으면 평가가 아무것도 재지 않는다)', () => {
        for (const s of golden.scenarios) {
            for (const policy of COMPACTION_POLICIES) {
                expect(evaluateCompactionScenario(s, policy).vanishedTurns).toBeGreaterThan(0);
            }
        }
    });

    it('본문 깊숙한 내용은 접기에서 사라진다 — 그 비율을 숨기지 않고 센다', () => {
        const fold = runCompactionGolden(golden).policies.find((p) => p.policy === 'fold')!;
        expect(fold.content.total).toBeGreaterThan(0);
        expect(fold.content.kept).toBeLessThan(fold.content.total);
    });
});

describe('채점기', () => {
    const scenario: CompactionScenario = {
        id: 't', goal: '목표',
        turns: [
            { tool: 'bash', args: { command: 'make build' }, result: 'Error: [stderr]\n{{filler:3000}}\nld: symbol not found\n[exit=2 5ms]', facts: [
                { id: 'cmd', text: 'make build', required: true },
                { id: 'never', text: '대화 어디에도 없는 문장', required: true },
            ] },
            ...Array.from({ length: 6 }, (_, i) => ({ tool: 'bash', args: { command: `echo ${i}` }, result: `[stdout]\n{{filler:3000}}\n[exit=0 1ms]` })),
        ],
    };

    it('채움 표기를 정해진 길이의 본문으로 편다(매번 같은 내용)', () => {
        const a = buildScenarioConversation(scenario);
        const b = buildScenarioConversation(scenario);
        expect(a).toEqual(b);
        expect(a[3].content.length).toBeGreaterThan(3000);
        expect(a[3].content).not.toContain('{{filler');
    });

    it('남아야 할 사실이 사라지면 그 사실 id 로 실패를 낸다', () => {
        const r = evaluateCompactionScenario(scenario, 'fold');
        expect(r.lostRequired).toEqual(['never']);
        expect(r.required).toEqual({ kept: 1, total: 2 });
    });

    it('사라지지 않은 턴의 사실은 세지 않는다', () => {
        const recent: CompactionScenario = { ...scenario, turns: scenario.turns.map((t, i) => (i === 6 ? { ...t, facts: [{ id: 'r', text: 'echo 5', required: true }] } : { ...t, facts: [] })) };
        expect(evaluateCompactionScenario(recent, 'fold').required.total).toBe(0);
    });
});
