/**
 * stopAllSchedulers() 가 "자체 타이머를 쓰는" 잡까지 멈추는지 고정 (2026-09-18).
 *
 * quota-reconcile-job 은 모듈 지역 변수 timer 를 쓰므로 schedulers/index.ts 의
 * activeTimers 루프가 잡지 못한다. 종전엔 stopQuotaReconcileJob 이 export 만 되고
 * 호출처가 0이라 "모든 백그라운드 스케줄러 종료" 계약이 조용히 깨져 있었다.
 * 같은 형태의 잡을 추가할 때 stop 배선을 빠뜨리면 이 테스트가 먼저 깨진다.
 */
jest.mock('../../data/conversation-db', () => ({
    startSessionCleanupScheduler: jest.fn(),
    stopSessionCleanupScheduler: jest.fn(),
}));
jest.mock('../../services/cost/quota-reconcile-job', () => ({
    startQuotaReconcileJob: jest.fn(),
    stopQuotaReconcileJob: jest.fn(),
}));
jest.mock('../../services/extensions/catalog-sync', () => ({
    startCatalogAutoSync: jest.fn(),
    stopCatalogAutoSync: jest.fn(),
}));
jest.mock('../../services/extensions/org-deployment', () => ({
    startOrgDeploymentReconcile: jest.fn(),
    stopOrgDeploymentReconcile: jest.fn(),
}));
jest.mock('../../data/db-retention', () => ({ startDbRetention: jest.fn() }));
jest.mock('../../utils/token-cleanup', () => ({ startPeriodicCleanup: jest.fn(), stopPeriodicCleanup: jest.fn() }));

import { stopAllSchedulers } from '../index';
import { stopQuotaReconcileJob } from '../../services/cost/quota-reconcile-job';
import { stopSessionCleanupScheduler } from '../../data/conversation-db';
import { stopCatalogAutoSync } from '../../services/extensions/catalog-sync';
import { stopOrgDeploymentReconcile } from '../../services/extensions/org-deployment';

describe('stopAllSchedulers', () => {
    beforeEach(() => jest.clearAllMocks());

    test('세션 정리 스케줄러를 중지한다', () => {
        stopAllSchedulers();
        expect(stopSessionCleanupScheduler).toHaveBeenCalledTimes(1);
    });

    test('쿼터 정산 잡(자체 타이머)을 중지한다', () => {
        stopAllSchedulers();
        expect(stopQuotaReconcileJob).toHaveBeenCalledTimes(1);
    });

    test('확장 카탈로그 주기 동기화(자체 타이머)를 중지한다', () => {
        stopAllSchedulers();
        expect(stopCatalogAutoSync).toHaveBeenCalledTimes(1);
    });

    test('조직 확장 배포 모드 조정(자체 타이머)을 중지한다', () => {
        stopAllSchedulers();
        expect(stopOrgDeploymentReconcile).toHaveBeenCalledTimes(1);
    });

    test('한 잡의 중지 실패가 나머지 중지를 막지 않는다', () => {
        (stopSessionCleanupScheduler as jest.Mock).mockImplementationOnce(() => {
            throw new Error('boom');
        });
        expect(() => stopAllSchedulers()).not.toThrow();
        expect(stopQuotaReconcileJob).toHaveBeenCalledTimes(1);
    });
});
