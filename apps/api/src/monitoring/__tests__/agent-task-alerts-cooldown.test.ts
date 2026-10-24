/**
 * 해소 알림과 쿨다운(#1478) — 진짜 AlertSystem 으로 본다. 경고의 쿨다운이 해소 알림을 막지 않고,
 * 해소 알림은 쿨다운 안에서도 전이마다 기록된다. 경고 자신의 반복은 종전처럼 쿨다운이 거른다.
 */
const system = jest.requireActual('../alerts').createAlertSystem({ channels: [], cooldownBySeverity: { info: 60, warning: 15, critical: 1 } });
jest.mock('../alerts', () => ({ ...jest.requireActual('../alerts'), getAlertSystem: () => system }));

import { sendAgentTaskAlert } from '../agent-task-alerts';

const types = (): string[] => system.getAlertHistory(100).map((a: { type: string }) => a.type);

it('경고 쿨다운 중에도 해소는 기록되고, 해소는 두 번째 전이에서도 기록된다 — 경고 반복은 쿨다운이 거른다', async () => {
    await sendAgentTaskAlert('agent_task_stale', '멈춤', '본문');
    await sendAgentTaskAlert('agent_task_stale_resolved', '해소', '본문');
    await sendAgentTaskAlert('agent_task_stale', '멈춤', '본문');
    await sendAgentTaskAlert('agent_task_stale_resolved', '해소', '본문');
    expect(types()).toEqual(['agent_task_stale', 'agent_task_stale_resolved', 'agent_task_stale_resolved']);
});
