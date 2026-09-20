/**
 * 모델 전환 게이트 — "프로필 추가 → eval:matrix 통과 → 전환" 의 통과 판정 (S2).
 */
import { judgeModelSwitch, modelSwitchThresholds, renderModelSwitchVerdict, type ModelSwitchThresholds } from '../model-switch-gate';

const T: ModelSwitchThresholds = { minPassRate: 0.8, maxPassRateDrop: 0.05, maxLatencyRegressionPct: 50, minLatencyAbsDeltaMs: 4_000 };
const cell = (model: string, variant: string, passRate: number, totalP95Ms: number | null = null, totalCases = 10) =>
    ({ model, variant, passRate, totalCases, totalP95Ms });

describe('judgeModelSwitch', () => {
    it('현행과 같은 수준이면 통과', () => {
        const v = judgeModelSwitch([cell('old', 'base', 0.9, 20_000), cell('new', 'base', 0.9, 22_000)], { candidate: 'new', incumbent: 'old' }, T);
        expect(v.ok).toBe(true);
    });

    it('절대 하한 미달은 현행이 더 나빠도 불가', () => {
        const v = judgeModelSwitch([cell('old', 'base', 0.5), cell('new', 'base', 0.7)], { candidate: 'new', incumbent: 'old' }, T);
        expect(v.ok).toBe(false);
        expect(v.rows[0].failures.join()).toContain('하한');
    });

    it('현행 대비 하락폭이 허용을 넘으면 불가 — 하한은 넘겨도', () => {
        const v = judgeModelSwitch([cell('old', 'base', 1.0), cell('new', 'base', 0.9)], { candidate: 'new', incumbent: 'old' }, T);
        expect(v.ok).toBe(false);
        expect(v.rows[0].failures.join()).toContain('%p');
    });

    it('variant 하나만 무너져도 전환 불가 (평균이 가리지 못한다)', () => {
        const v = judgeModelSwitch([
            cell('old', 'base', 0.9), cell('old', 'thinking', 0.9),
            cell('new', 'base', 1.0), cell('new', 'thinking', 0.6),
        ], { candidate: 'new', incumbent: 'old' }, T);
        expect(v.ok).toBe(false);
        expect(v.rows.find((r) => r.variant === 'base')?.failures).toEqual([]);
        expect(v.rows.find((r) => r.variant === 'thinking')?.failures.length).toBeGreaterThan(0);
    });

    it('지연 회귀는 비율과 절대폭을 둘 다 넘어야 잡는다', () => {
        const noisy = judgeModelSwitch([cell('old', 'base', 0.9, 2_000), cell('new', 'base', 0.9, 5_000)], { candidate: 'new', incumbent: 'old' }, T);
        expect(noisy.ok).toBe(true); // +150% 지만 절대 +3s — 잡음
        const real = judgeModelSwitch([cell('old', 'base', 0.9, 20_000), cell('new', 'base', 0.9, 40_000)], { candidate: 'new', incumbent: 'old' }, T);
        expect(real.ok).toBe(false);
    });

    it('현행을 지정했는데 같은 variant 셀이 없으면 불가 — 조용히 절대 하한만 보지 않는다', () => {
        const v = judgeModelSwitch([cell('old', 'base', 0.9), cell('new', 'concise', 0.9)], { candidate: 'new', incumbent: 'old' }, T);
        expect(v.ok).toBe(false);
        expect(v.rows[0].failures.join()).toContain('비교 불가');
    });

    it('후보 셀 없음·케이스 0건·같은 모델은 판정 불가 사유와 함께 불가', () => {
        expect(judgeModelSwitch([cell('old', 'base', 1)], { candidate: 'new', incumbent: 'old' }, T).reason).toContain('셀이 없습니다');
        expect(judgeModelSwitch([cell('new', 'base', 0, null, 0)], { candidate: 'new' }, T).reason).toContain('0건');
        expect(judgeModelSwitch([cell('new', 'base', 1)], { candidate: 'new', incumbent: 'new' }, T).reason).toContain('같은 모델');
    });

    it('현행 미지정이면 절대 하한만 본다', () => {
        expect(judgeModelSwitch([cell('new', 'base', 0.85)], { candidate: 'new' }, T).ok).toBe(true);
    });

    it('임계값은 env 로 덮는다 — 빈 문자열은 기본값', () => {
        process.env.OMK_EVAL_SWITCH_MIN_PASS_RATE = '0.95';
        process.env.OMK_EVAL_SWITCH_MAX_PASS_DROP = '';
        try {
            const t = modelSwitchThresholds();
            expect(t.minPassRate).toBe(0.95);
            expect(t.maxPassRateDrop).toBe(0.05);
        } finally {
            delete process.env.OMK_EVAL_SWITCH_MIN_PASS_RATE;
            delete process.env.OMK_EVAL_SWITCH_MAX_PASS_DROP;
        }
    });

    it('표시는 variant 별 사유를 싣는다', () => {
        const v = judgeModelSwitch([cell('old', 'base', 1.0), cell('new', 'base', 0.5)], { candidate: 'new', incumbent: 'old' }, T);
        const text = renderModelSwitchVerdict(v);
        expect(text).toContain('불가');
        expect(text).toContain('base');
    });
});
