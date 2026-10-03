/**
 * 예약 실행 결과 반영 — 예약이 만든 작업의 종료 결과를 예약에 되돌린다.
 *
 * - 같은 오류 서명의 실패는 종료 알림을 한 번만 보낸다(매일 같은 이유로 실패하는 예약이 매일 알리지 않게).
 * - 연속 N회 실패하면 예약을 끄고 사유를 남긴다.
 * - 성공하면 실패 기록을 푼다.
 * 작업이 종료 상태를 쓸 때(AgentTaskService 의 onTerminal) 불리고, 돌려준 값이 종료 푸시 여부다.
 *
 * @module services/agent-task/schedule-outcome
 */
import { classifyAgentTaskFailure } from '../../config/agent-task-failure-class';
import { AGENT_TASK_SCHEDULE, SCHEDULE_UNCOUNTED_FAILURE_CLASSES } from '../../config/agent-task-schedule';
import { getScheduleDisabledReason, getScheduleDisabledPush } from '../../prompts/agent-task-schedule';
import type { AgentTaskScheduleRepository } from '../../data/repositories/agent-task-schedule-repository';
import { getPushService } from '../PushService';
import { createLogger } from '../../utils/logger';
import type { AgentTaskTerminalInfo } from './types';

const logger = createLogger('AgentTaskSchedule');

export type ScheduleOutcomeRepo = Pick<AgentTaskScheduleRepository, 'get' | 'recordRunSuccess' | 'recordRunFailure'>;

export interface ScheduleRunState {
    consecutiveFailures: number;
    lastFailureSignature: string | null;
}

export type ScheduleOutcomeDecision =
    /** 예약에 반영하지 않는다(취소·서버 재시작 중단). */
    | { kind: 'ignore'; push: boolean }
    | { kind: 'success'; push: boolean }
    | { kind: 'failure'; push: boolean; signature: string; failureClass: string; failures: number; disable: boolean };

/** PURE: 오류 → 서명. 분류 + 숫자·식별자를 지운 오류 문구 앞부분 — 요청 id 만 다른 같은 실패를 하나로 묶는다. */
export function failureSignature(error: string | null | undefined): string {
    const normalized = (error ?? '').toLowerCase().replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '#').replace(/\d+/g, '#')
        .replace(/\s+/g, ' ').trim().slice(0, AGENT_TASK_SCHEDULE.SIGNATURE_ERROR_CHARS);
    return `${classifyAgentTaskFailure(error)}:${normalized}`;
}

/** PURE: 종료 결과와 예약의 현재 기록으로 무엇을 할지 정한다. */
export function decideScheduleOutcome(
    state: ScheduleRunState, t: AgentTaskTerminalInfo, cfg: { disableAfter: number },
): ScheduleOutcomeDecision {
    if (t.status === 'completed') return { kind: 'success', push: true };
    const failureClass = classifyAgentTaskFailure(t.error);
    if (t.status !== 'failed' || SCHEDULE_UNCOUNTED_FAILURE_CLASSES.has(failureClass)) return { kind: 'ignore', push: true };
    const signature = failureSignature(t.error);
    const failures = state.consecutiveFailures + 1;
    return {
        kind: 'failure', push: signature !== state.lastFailureSignature, signature, failureClass, failures,
        disable: failures >= cfg.disableAfter,
    };
}

/**
 * 종료 결과를 예약에 반영하고 종료 푸시를 보낼지 돌려준다. 던지지 않는다 — 반영 실패가 작업 종료 처리를 깨면 안 되고,
 * 판단할 수 없으면 알리는 쪽(true)으로 둔다.
 */
export async function applyScheduleOutcome(
    repo: ScheduleOutcomeRepo, scheduleId: string, t: AgentTaskTerminalInfo,
    cfg: { disableAfter: number } = { disableAfter: AGENT_TASK_SCHEDULE.RUN_FAILURE_DISABLE_AFTER },
): Promise<boolean> {
    try {
        const s = await repo.get(scheduleId);
        if (!s) return true;
        const d = decideScheduleOutcome(
            { consecutiveFailures: s.consecutive_failures ?? 0, lastFailureSignature: s.last_failure_signature ?? null }, t, cfg);
        if (d.kind === 'success') {
            await repo.recordRunSuccess(scheduleId);
        } else if (d.kind === 'failure') {
            await repo.recordRunFailure(scheduleId, {
                failures: d.failures, signature: d.signature, disable: d.disable,
                reason: d.disable ? getScheduleDisabledReason(d.failures, d.failureClass) : null,
            });
            if (d.disable) {
                logger.warn(`[Schedule] 연속 ${d.failures}회 실행 실패 — 예약 자동 비활성: ${scheduleId} (${d.signature})`);
                void getPushService().sendPush(String(s.user_id), getScheduleDisabledPush(s.goal, d.failures)).catch(() => { /* noop */ });
            }
        }
        return d.push;
    } catch (e) {
        logger.warn(`[Schedule] 실행 결과 반영 실패: ${scheduleId} — ${e instanceof Error ? e.message : e}`);
        return true;
    }
}
