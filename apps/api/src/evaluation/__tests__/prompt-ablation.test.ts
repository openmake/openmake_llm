/**
 * 프롬프트 규칙 제거(ablation) — 시스템 프롬프트에서 지정한 규칙 묶음만 빼고 나머지는 그대로 두는지.
 */
import { ablatePrompt, summarizeAblation, type AblationRun } from '../prompt-ablation';

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
