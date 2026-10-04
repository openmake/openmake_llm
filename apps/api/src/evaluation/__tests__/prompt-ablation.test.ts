/**
 * 프롬프트 규칙 제거(ablation) — 시스템 프롬프트에서 지정한 규칙 묶음만 빼고 나머지는 그대로 두는지.
 */
import { ablatePrompt, summarizeAblation, gateAgentTaskSuite, selectCases, type AblationRun } from '../prompt-ablation';

const PROMPT = [
    'You are an agent.',
    '',
    '- Do NOT call tools unnecessarily.',
    '- For search tools: start with short queries,',
    '  then narrow. Never repeat queries.',
    '- When the goal is achieved, give a FINAL answer.',
    '',
    'DELIVERABLE rules:',
    '- The final answer MUST contain the deliverable.',
].join('\n');

describe('ablatePrompt', () => {
    it('패턴에 맞는 규칙(글머리표와 이어지는 줄)만 통째로 뺀다', () => {
        const out = ablatePrompt(PROMPT, ['search tools']);
        expect(out).not.toContain('search tools');
        expect(out).not.toContain('then narrow');
        expect(out).toContain('- Do NOT call tools unnecessarily.');
        expect(out).toContain('- When the goal is achieved');
        expect(out).toContain('DELIVERABLE rules:');
    });

    it('패턴이 없으면 원문 그대로다(기준 조건)', () => {
        expect(ablatePrompt(PROMPT, [])).toBe(PROMPT);
    });

    it('글머리표가 아닌 줄(제목 등)은 규칙이 아니다 — 그런 줄에만 맞는 패턴은 던진다', () => {
        expect(() => ablatePrompt(PROMPT, ['DELIVERABLE rules:'])).toThrow();
    });

    it('아무 규칙에도 맞지 않는 패턴은 던진다 — 빼지도 않고 뺀 것으로 측정되는 일을 막는다', () => {
        expect(() => ablatePrompt(PROMPT, ['no such rule'])).toThrow();
    });
});

describe('summarizeAblation', () => {
    const run = (variant: string, over: Partial<AblationRun>): AblationRun => ({
        variant, taskId: 't', caseId: 'c', status: 'completed', processPassed: true, rootFailures: [], turns: 2, totalTokens: 1000, toolCalls: 3, durationMs: 1000, ...over,
    });

    it('조건별로 완료율·과정 통과율·평균 토큰·평균 턴을 낸다', () => {
        const s = summarizeAblation([
            run('baseline', { totalTokens: 1000 }), run('baseline', { status: 'failed', processPassed: false, totalTokens: 3000 }),
            run('drop', { totalTokens: 500, turns: 1 }),
        ]);
        expect(s.find((v) => v.variant === 'baseline')).toMatchObject({ runs: 2, completedRate: 0.5, processPassRate: 0.5, meanTokens: 2000, meanTurns: 2 });
        expect(s.find((v) => v.variant === 'drop')).toMatchObject({ runs: 1, completedRate: 1, meanTokens: 500, meanTurns: 1 });
    });
});

describe('summarizeAblation — 정답 문자열 판정이 있는 과제(브라우저)', () => {
    const run = (over: Partial<AblationRun>): AblationRun => ({
        variant: 'baseline', taskId: 't', caseId: 'c', status: 'completed', processPassed: true, rootFailures: [], turns: 2, totalTokens: 1000, toolCalls: 3, durationMs: 1000, ...over,
    });

    it('작업이 completed 여도 정답이 답변에 없으면 완료로 세지 않는다', () => {
        const s = summarizeAblation([run({ answerPassed: true }), run({ answerPassed: false }), run({}), run({ status: 'failed', answerPassed: true })]);
        expect(s[0]).toMatchObject({ runs: 4, completedRate: 0.5 });
    });
});

describe('gateAgentTaskSuite', () => {
    const summary = (completedRate: number, processPassRate: number) => [{ variant: 'baseline', runs: 8, completedRate, processPassRate, meanTokens: 1, meanTurns: 1, meanToolCalls: 1 }];
    const thresholds = { completed: 0.8, process: 0.9 };

    it('완료율과 과정 통과율이 모두 임계 이상이면 통과', () => {
        expect(gateAgentTaskSuite(summary(0.875, 1), thresholds)).toEqual({ ok: true, failures: [] });
    });
    it('어느 한쪽이 임계 미만이면 실패하고 어느 쪽인지 밝힌다', () => {
        expect(gateAgentTaskSuite(summary(0.75, 1), thresholds).failures).toEqual([expect.stringContaining('완료율')]);
        expect(gateAgentTaskSuite(summary(1, 0.5), thresholds).failures).toEqual([expect.stringContaining('과정')]);
    });
    it('실행이 한 건도 없으면 실패다 — 돌지 않은 평가가 통과로 보이지 않게', () => {
        expect(gateAgentTaskSuite([], thresholds).ok).toBe(false);
    });
});

describe('selectCases', () => {
    const cases = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

    it('아무것도 주지 않으면 전부, --limit 은 앞에서 N개', () => {
        expect(selectCases(cases, {})).toEqual(cases);
        expect(selectCases(cases, { limit: 2 }).map((c) => c.id)).toEqual(['a', 'b']);
    });
    it('--only 는 지목한 과제만 묶음의 순서대로 고른다(뒤쪽 과제 하나만 돌릴 수 있다)', () => {
        expect(selectCases(cases, { only: ['c'] }).map((c) => c.id)).toEqual(['c']);
        expect(selectCases(cases, { only: ['c', 'a'] }).map((c) => c.id)).toEqual(['a', 'c']);
    });
    it('--only 로 고른 뒤에 --limit 을 적용한다', () => {
        expect(selectCases(cases, { only: ['b', 'c'], limit: 1 }).map((c) => c.id)).toEqual(['b']);
    });
    it('없는 id 를 지목하면 던진다 — 오타로 아무것도 돌지 않는 일을 막는다', () => {
        expect(() => selectCases(cases, { only: ['a', 'zzz'] })).toThrow('zzz');
    });
});
