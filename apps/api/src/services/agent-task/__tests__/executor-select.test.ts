/**
 * resolveExecutorPlan — 로컬 실행기의 승인 정책 결정.
 * 회귀 고정: 로컬 실행에서 호출자가 명시한 approvalPolicy 가 'all' 로 덮어써지지 않아야 한다
 * (웹 컴포저 "건너뜀" 이 무시되던 결함, 2026-09-05).
 */
jest.mock('../../../config/local-bridge', () => ({ LOCAL_BRIDGE: { ENABLED: true } }));
jest.mock('../../../config/task-sandbox', () => ({
    getTaskSandboxConfig: () => ({ enabled: false, approvalPolicy: 'high-risk', browserEnabled: true, network: 'restricted' }),
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

describe('resolveExecutorPlan — 이어받은 세그먼트의 worktree 키', () => {
    it('worktreeKey 가 RemoteExecutor 로 전달된다(없으면 undefined — 실행기가 자기 taskId 를 쓴다)', () => {
        const { RemoteExecutor } = jest.requireMock('../../local-bridge/remote-executor') as { RemoteExecutor: jest.Mock };
        RemoteExecutor.mockClear();
        resolveExecutorPlan({ executor: 'local', deviceId: 'd1', folderRel: 'f' }, 'seg2', 'u1', 'root');
        expect(RemoteExecutor).toHaveBeenLastCalledWith('seg2', 'u1', 'd1', 'f', 'root');
        resolveExecutorPlan({ executor: 'local' }, 't1', 'u1');
        expect(RemoteExecutor).toHaveBeenLastCalledWith('t1', 'u1', undefined, undefined, undefined);
    });
});

describe('resolveExecutorPlan — 반출 관문(하네스 P0-2)', () => {
    const egress = jest.requireActual('../../../config/egress-policy') as typeof import('../../../config/egress-policy');
    const limits = egress.EGRESS_POLICY as { INTERNAL_ONLY_SENSITIVITY: string };
    afterEach(() => { limits.INTERNAL_ONLY_SENSITIVITY = 'off'; });

    it('로컬 실행기는 내부 전용(브라우저 설정은 건드리지 않는다)', () => {
        const plan = resolveExecutorPlan({ executor: 'local', goal: '정리해줘' }, 't1', 'u1');
        expect(plan.sandboxCfg.internalOnly).toBe(true);
        expect(plan.sandboxCfg.browserEnabled).toBe(true);
    });

    it('기준 off 면 샌드박스 작업은 민감 자료여도 내부 전용이 아니다', () => {
        const plan = resolveExecutorPlan({ executor: 'sandbox', goal: '[대외비] 정리' }, 't1', 'u1');
        expect(plan.sandboxCfg.internalOnly).toBeUndefined();
    });

    it('기준 confidential — 목표·첨부가 걸리면 샌드박스도 내부 전용: 브라우저 끔·명령 망 없음', () => {
        limits.INTERNAL_ONLY_SENSITIVITY = 'confidential';
        const plan = resolveExecutorPlan({ executor: 'sandbox', goal: '정리해줘', files: [{ name: 'a.txt', content: 'CONFIDENTIAL' }] }, 't1', 'u1');
        expect(plan.sandboxCfg).toMatchObject({ internalOnly: true, browserEnabled: false, network: 'none' });
        expect(resolveExecutorPlan({ executor: 'sandbox', goal: '날씨' }, 't1', 'u1').sandboxCfg.internalOnly).toBeUndefined();
    });
});
