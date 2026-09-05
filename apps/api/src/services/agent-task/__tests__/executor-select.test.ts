/**
 * resolveExecutorPlan — 로컬 실행기의 승인 정책 결정.
 * 회귀 고정: 로컬 실행에서 호출자가 명시한 approvalPolicy 가 'all' 로 덮어써지지 않아야 한다
 * (웹 컴포저 "건너뜀" 이 무시되던 결함, 2026-09-05).
 */
jest.mock('../../../config/local-bridge', () => ({ LOCAL_BRIDGE: { ENABLED: true } }));
jest.mock('../../../config/task-sandbox', () => ({
    getTaskSandboxConfig: () => ({ enabled: false, approvalPolicy: 'high-risk' }),
}));
jest.mock('../../local-bridge/remote-executor', () => ({
    RemoteExecutor: jest.fn().mockImplementation(() => ({})),
}));

import { resolveExecutorPlan } from '../executor-select';

describe('resolveExecutorPlan — 로컬 실행 승인 정책', () => {
    it('명시한 none 은 그대로 적용된다', () => {
        const plan = resolveExecutorPlan({ executor: 'local', approvalPolicy: 'none' }, 't1', 'u1');
        expect(plan.sandboxCfg.approvalPolicy).toBe('none');
        expect(plan.sandboxCfg.deviceGatesShell).toBe(true);
        expect(plan.remoteExecutor).toBeDefined();
    });

    it('명시한 high-risk 도 그대로 적용된다', () => {
        const plan = resolveExecutorPlan({ executor: 'local', approvalPolicy: 'high-risk' }, 't1', 'u1');
        expect(plan.sandboxCfg.approvalPolicy).toBe('high-risk');
    });

    it('미지정이면 전역 기본값이 아니라 all 로 보수적으로 둔다', () => {
        const plan = resolveExecutorPlan({ executor: 'local' }, 't1', 'u1');
        expect(plan.sandboxCfg.approvalPolicy).toBe('all');
        expect(plan.runtimeEnabled).toBe(true);
    });

    it('샌드박스 실행은 종전대로 — 미지정이면 전역 기본값', () => {
        const plan = resolveExecutorPlan({ executor: 'sandbox' }, 't1', 'u1');
        expect(plan.sandboxCfg.approvalPolicy).toBe('high-risk');
        expect(plan.sandboxCfg.deviceGatesShell).toBeUndefined();
        expect(plan.remoteExecutor).toBeUndefined();
    });
});
