/**
 * 에이전트 작업 알림 5종(R8, R9) — 종류별 심각도로 AlertSystem 에 보내고, 보내기가 실패해도 호출부를 깨지 않는다.
 */
const sendAlert = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../alerts', () => ({ getAlertSystem: () => ({ sendAlert: (...a: unknown[]) => sendAlert(...a) }) }));

import { sendAgentTaskAlert, AGENT_TASK_ALERT_SEVERITY, ALERT_TEXT } from '../agent-task-alerts';

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
        });
    });

    it('sendAlert 가 던져도 resolve 한다', async () => {
        sendAlert.mockRejectedValueOnce(new Error('webhook down'));
        await expect(sendAgentTaskAlert('agent_task_stale', '제목', '본문')).resolves.toBeUndefined();
    });

    it('문구 상수는 data 로 본문을 만든다', () => {
        expect(ALERT_TEXT.agent_task_stale.message({ count: 2, oldestStalledMs: 20 * 60_000 })).toContain('2건');
        expect(ALERT_TEXT.agent_task_lease_takeover.message({ taskId: 't9', previousOwner: 'h:1' })).toContain('t9');
    });
});
