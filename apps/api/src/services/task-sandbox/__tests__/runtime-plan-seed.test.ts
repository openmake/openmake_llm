/**
 * TaskRuntime 초기 계획 심기 — 실제 결함이 사라졌는지 런타임 레벨로 고정.
 *
 * 결함(실측 2026-08-28): goal 에 `[절차] 1)…7)` 이 있으면 모델이 plan_create 없이
 * `plan_update(step:2, status:'in_progress')` 를 부르고 "아직 계획이 없습니다" 로 턴을 버렸다.
 * plan 프로토콜 오류 28건 중 20건이 이 형태.
 */
import { TaskRuntime } from '../runtime';
import { getTaskSandboxConfig } from '../../../config/task-sandbox';

// 승인 게이트가 개입하지 않는 정책으로 고정(plan_* 는 원래 승인 불요지만 명시).
const cfg = { ...getTaskSandboxConfig(), approvalPolicy: 'none' as const };

const GOAL_WITH_STEPS = [
    'AI 트렌드 리포트를 생성한다.',
    '[절차]',
    '1) 검색: 최근 24h 뉴스.',
    '2) 검증: fact_check 로 교차확인.',
    '3) 분석: 3관점으로 해석.',
].join('\n');

describe('TaskRuntime 초기 계획 심기', () => {
    it('goal 절차가 있으면 plan_create 없이 plan_update(step:2) 가 성공한다 (회귀 고정)', async () => {
        const rt = new TaskRuntime('t-seed', 'u1', cfg, undefined, undefined, undefined, GOAL_WITH_STEPS);
        const res = await rt.executeTaskTool('plan_update', { step: 2, status: 'in_progress' });
        expect(res).not.toContain('아직 계획이 없습니다');
        expect(res).not.toContain('범위를 벗어');
    });

    it('심어진 계획이 goal 의 단계 텍스트를 담는다', async () => {
        const rt = new TaskRuntime('t-seed2', 'u1', cfg, undefined, undefined, undefined, GOAL_WITH_STEPS);
        const view = await rt.executeTaskTool('plan_view', {});
        expect(view).toContain('검색');
        expect(view).toContain('fact_check');
        expect(view).toContain('3관점');
    });

    it('goal 이 없거나 절차가 없으면 종전 동작 — 계획 없음 오류가 그대로 난다', async () => {
        const rt = new TaskRuntime('t-noseed', 'u1', cfg, undefined, undefined, undefined, '파일 하나 만들어줘');
        const res = await rt.executeTaskTool('plan_update', { step: 2, status: 'in_progress' });
        expect(res).toContain('계획이 없습니다');

        const rt2 = new TaskRuntime('t-nogoal', 'u1', cfg);
        const res2 = await rt2.executeTaskTool('plan_update', { step: 1, status: 'in_progress' });
        expect(res2).toContain('계획이 없습니다');
    });

    it('모델이 plan_create 를 부르면 기존 상태 보존 병합이 받는다 (심은 계획을 덮어쓰지 않음)', async () => {
        const rt = new TaskRuntime('t-seed3', 'u1', cfg, undefined, undefined, undefined, GOAL_WITH_STEPS);
        await rt.executeTaskTool('plan_update', { step: 1, status: 'completed' });
        // 같은 텍스트로 재생성 — 1단계의 completed 가 보존되어야 한다.
        await rt.executeTaskTool('plan_create', {
            steps: ['검색: 최근 24h 뉴스.', '검증: fact_check 로 교차확인.', '분석: 3관점으로 해석.'],
        });
        const view = await rt.executeTaskTool('plan_view', {});
        expect(view).toContain('[x]');
    });
});
