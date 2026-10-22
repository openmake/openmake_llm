/**
 * 에이전트 작업 알림 5종(R8, R9) — 복구 상한·소유권 이어받기·대기열 적체·모델 대기 장기화·진행 멈춤.
 * AlertSystem(monitoring/alerts) 에 종류별 심각도로 보낸다. 같은 종류의 반복은 AlertSystem 쿨다운(type:severity)이 거른다.
 * 보내기 실패는 호출부(부팅 복구·watchdog)를 깨지 않는다 — 절대 throw 하지 않는다.
 *
 * @module monitoring/agent-task-alerts
 */
import { createLogger } from '../utils/logger';

const logger = createLogger('AgentTaskAlerts');

export type AgentTaskAlertType =
    | 'agent_task_recovery_limit'
    | 'agent_task_lease_takeover'
    | 'agent_task_queue_backlog'
    | 'agent_task_model_wait_long'
    | 'agent_task_stale';

/** 종류별 심각도 — 자동 재개가 끊긴 작업만 critical, 이어받기는 정상 복구라 info */
export const AGENT_TASK_ALERT_SEVERITY: Record<AgentTaskAlertType, 'info' | 'warning' | 'critical'> = {
    agent_task_recovery_limit: 'critical',
    agent_task_lease_takeover: 'info',
    agent_task_queue_backlog: 'warning',
    agent_task_model_wait_long: 'warning',
    agent_task_stale: 'warning',
};

const minutes = (ms: unknown): number => Math.round(Number(ms ?? 0) / 60_000);

/** 알림 제목·본문 — 본문은 알림 data 로 만든다 */
export const ALERT_TEXT: Record<AgentTaskAlertType, { title: string; message: (d: Record<string, unknown>) => string }> = {
    agent_task_recovery_limit: {
        title: '에이전트 작업 자동 복구 중단',
        message: (d) => `작업 ${d.taskId} 이(가) 진행 없이 ${d.attempts}회 복구돼 자동 재개를 멈췄습니다(recovery_limit). 체크포인트는 남아 있어 직접 이어 할 수 있습니다.`,
    },
    agent_task_lease_takeover: {
        title: '에이전트 작업 실행 소유권 이어받음',
        message: (d) => `작업 ${d.taskId} 의 실행 소유권이 지나 이 서버가 가져와 이어 실행합니다(이전 소유자 ${d.previousOwner ?? '-'}).`,
    },
    agent_task_queue_backlog: {
        title: '에이전트 작업 대기열 적체',
        message: (d) => `대기 ${d.pending}건, 실행 ${d.active}건, 가장 오래 기다린 작업 ${minutes(d.oldestWaitMs)}분.`,
    },
    agent_task_model_wait_long: {
        title: '에이전트 작업 모델 대기 장기화',
        message: (d) => `모델 서버를 ${minutes(d.thresholdMs)}분 넘게 기다리는 작업 ${d.count}건.`,
    },
    agent_task_stale: {
        title: '에이전트 작업 진행 멈춤',
        message: (d) => `실행 중인데 진행이 멈춘 작업 ${d.count}건, 가장 오래 멈춘 시간 ${minutes(d.oldestStalledMs)}분.`,
    },
};

/** 알림을 보낸다 — 실패는 경고 로그만 남기고 삼킨다 */
export async function sendAgentTaskAlert(type: AgentTaskAlertType, title: string, message: string, data?: Record<string, unknown>): Promise<void> {
    try {
        await (await import('./alerts')).getAlertSystem().sendAlert(type, AGENT_TASK_ALERT_SEVERITY[type], title, message, data);
    } catch (err) {
        logger.warn(`알림 보내기 실패(무시): ${type} — ${err instanceof Error ? err.message : String(err)}`);
    }
}
