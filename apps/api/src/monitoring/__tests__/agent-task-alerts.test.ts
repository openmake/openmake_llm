/**
 * 에이전트 작업 알림 5종(R8, R9)과 해소 3종(#1478) — 종류별 심각도로 AlertSystem 에 보내고, 보내기가 실패해도 호출부를 깨지 않는다.
 */
const sendAlert = jest.fn(async (..._a: unknown[]) => undefined);
const clearCooldown = jest.fn((..._a: unknown[]) => true);
jest.mock('../alerts', () => ({ getAlertSystem: () => ({ sendAlert: (...a: unknown[]) => sendAlert(...a), clearCooldown: (...a: unknown[]) => clearCooldown(...a) }) }));

import { sendAgentTaskAlert, AGENT_TASK_ALERT_SEVERITY, AGENT_TASK_RESOLVED_ALERT, ALERT_TEXT } from '../agent-task-alerts';

beforeEach(() => jest.clearAllMocks());

describe('sendAgentTaskAlert', () => {
    it('종류별 심각도로 sendAlert 를 부른다', async () => {
        await sendAgentTaskAlert('agent_task_recovery_limit', '제목', '본문', { taskId: 't1' });
        expect(sendAlert).toHaveBeenCalledWith('agent_task_recovery_limit', 'critical', '제목', '본문', { taskId: 't1' });
    });

    it('심각도 매핑 — recovery_limit critical, lease_takeover info, 나머지 warning', () => {
        expect(AGENT_TASK_ALERT_SEVERITY).toEqual({
            agent_task_recovery_limit: 'critical',
            agent_task_lease_takeover: 'info',
            agent_task_queue_backlog: 'warning',
            agent_task_model_wait_long: 'warning',
            agent_task_stale: 'warning',
            agent_task_stale_resolved: 'info',
            agent_task_queue_backlog_resolved: 'info',
            agent_task_model_wait_long_resolved: 'info',
            agent_task_stale_pending: 'warning',
            agent_task_stale_pending_resolved: 'info',
        });
    });

    it('해소 알림(#1478)은 경고 종류마다 하나 — 정상 전이마다 보내도록 보낼 때마다 자기 쿨다운을 지운다', async () => {
        expect(AGENT_TASK_RESOLVED_ALERT).toEqual({
            agent_task_stale: 'agent_task_stale_resolved',
            agent_task_queue_backlog: 'agent_task_queue_backlog_resolved',
            agent_task_model_wait_long: 'agent_task_model_wait_long_resolved',
            agent_task_stale_pending: 'agent_task_stale_pending_resolved',
        });
        await sendAgentTaskAlert('agent_task_stale_resolved', '제목', '본문');
        await sendAgentTaskAlert('agent_task_stale_resolved', '제목', '본문');
        expect(clearCooldown).toHaveBeenCalledTimes(2);
        expect(clearCooldown).toHaveBeenCalledWith('agent_task_stale_resolved', 'info');
        expect(sendAlert).toHaveBeenCalledWith('agent_task_stale_resolved', 'info', '제목', '본문', undefined);
    });

    it('sendAlert 가 던져도 resolve 한다', async () => {
        sendAlert.mockRejectedValueOnce(new Error('webhook down'));
        await expect(sendAgentTaskAlert('agent_task_stale', '제목', '본문')).resolves.toBeUndefined();
    });

    it('recovery_limit 은 작업마다 알린다 — 보낼 때마다 쿨다운을 지운다', async () => {
        await sendAgentTaskAlert('agent_task_recovery_limit', '제목', '본문', { taskId: 't1' });
        await sendAgentTaskAlert('agent_task_recovery_limit', '제목', '본문', { taskId: 't2' });
        expect(clearCooldown).toHaveBeenCalledTimes(2);
        expect(clearCooldown).toHaveBeenCalledWith('agent_task_recovery_limit', 'critical');
        expect(sendAlert).toHaveBeenCalledTimes(2);
    });

    it('오래된 pending(#1478) — 경고는 warning, 해소는 info 이고 해소만 보낼 때마다 자기 쿨다운을 지운다', async () => {
        await sendAgentTaskAlert('agent_task_stale_pending', '제목', '본문', { count: 3 });
        expect(sendAlert).toHaveBeenCalledWith('agent_task_stale_pending', 'warning', '제목', '본문', { count: 3 });
        expect(clearCooldown).not.toHaveBeenCalled();
        await sendAgentTaskAlert('agent_task_stale_pending_resolved', '제목', '본문');
        expect(clearCooldown).toHaveBeenCalledWith('agent_task_stale_pending_resolved', 'info');
        expect(sendAlert).toHaveBeenCalledWith('agent_task_stale_pending_resolved', 'info', '제목', '본문', undefined);
    });

    it('나머지 종류는 쿨다운을 그대로 탄다', async () => {
        await sendAgentTaskAlert('agent_task_stale', '제목', '본문');
        await sendAgentTaskAlert('agent_task_stale', '제목', '본문');
        expect(clearCooldown).not.toHaveBeenCalled();
        expect(sendAlert).toHaveBeenCalledTimes(2);
    });

    it('문구 상수는 data 로 본문을 만든다', () => {
        expect(ALERT_TEXT.agent_task_stale.message({ count: 2, oldestStalledMs: 20 * 60_000 })).toContain('2건');
        expect(ALERT_TEXT.agent_task_lease_takeover.message({ taskId: 't9', previousOwner: 'h:1' })).toContain('t9');
        expect(ALERT_TEXT.agent_task_queue_backlog_resolved.message({ pending: 2, active: 1, oldestWaitMs: 0 })).toContain('2건');
        expect(ALERT_TEXT.agent_task_model_wait_long_resolved.message({ parked: 4, thresholdMs: 30 * 60_000 })).toContain('30분');
        expect(ALERT_TEXT.agent_task_stale_pending.title).toBeTruthy();
        expect(ALERT_TEXT.agent_task_stale_pending.message({ count: 57, oldestStalledMs: 45 * 60_000, taskIds: ['p1'] })).toContain('57건');
        expect(ALERT_TEXT.agent_task_stale_pending.message({ count: 57, oldestStalledMs: 45 * 60_000, taskIds: ['p1'] })).toContain('45분');
        expect(ALERT_TEXT.agent_task_stale_pending_resolved.title).toBeTruthy();
        expect(ALERT_TEXT.agent_task_stale_pending_resolved.message({ count: 0 })).toEqual(expect.any(String));
    });
});
