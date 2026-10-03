/**
 * 예약 실행 결과 반영 — 예약이 만든 작업의 종료 결과를 예약에 되돌린다.
 *
 * - 같은 오류 서명의 실패는 종료 알림을 한 번만 보낸다(매일 같은 이유로 실패하는 예약이 매일 알리지 않게).
 * - 연속 N회 실패하면 예약을 끄고 사유를 남긴다.
 * - 성공하면 실패 기록을 푼다.
 * - 모델에 닿지 못한 실행(모델 응답 0회 + 연결 실패·5xx)은 실패로 세지 않고 5·15·30분 뒤 다시 돌린다.
 * - "보고할 것 없음" 표식으로 시작하는 최종 응답은 종료 알림을 생략한다(기본 꺼짐). 완료 판정은 건드리지 않는다.
 * 작업이 종료 상태를 쓸 때(AgentTaskService 의 onTerminal) 불리고, 돌려준 값이 종료 푸시 여부다.
 *
 * @module services/agent-task/schedule-outcome
 */
import { classifyAgentTaskFailure } from '../../config/agent-task-failure-class';
import { AGENT_TASK_SCHEDULE, SCHEDULE_UNCOUNTED_FAILURE_CLASSES, SCHEDULE_UNREACHABLE_ERROR_RE } from '../../config/agent-task-schedule';
import { getScheduleDisabledReason, getScheduleDisabledPush, AGENT_TASK_SCHEDULE_SILENT_MARKER } from '../../prompts/agent-task-schedule';
import type { AgentTaskScheduleRepository } from '../../data/repositories/agent-task-schedule-repository';
import { getPushService } from '../PushService';
import { createLogger } from '../../utils/logger';
import type { AgentTaskTerminalInfo } from './types';

const logger = createLogger('AgentTaskSchedule');

export type ScheduleOutcomeRepo = Pick<AgentTaskScheduleRepository, 'get' | 'recordRunSuccess' | 'recordRunFailure' | 'scheduleRetry'>;

export interface ScheduleRunState {
    consecutiveFailures: number;
    lastFailureSignature: string | null;
    /** 이번 정규 발화에서 이미 쓴 재실행 횟수. */
    retryAttempt?: number;
    /** 다음 정규 발화 시각 — 재실행이 이보다 늦으면 재실행하지 않는다. */
    nextRunAtMs?: number | null;
}

export interface ScheduleOutcomeConfig {
    disableAfter: number;
    /** 재실행 대기 목록 — 없으면 재실행하지 않는다. */
    retryDelaysMs?: readonly number[];
    nowMs?: number;
    /** "보고할 것 없음" 표식 — 없으면 이 기능은 꺼져 있다. */
    silentMarker?: string;
}

export type ScheduleOutcomeDecision =
    /** 예약에 반영하지 않는다(취소·서버 재시작 중단). */
    | { kind: 'ignore'; push: boolean }
    | { kind: 'success'; push: boolean }
    /** 모델 미도달 — 실패로 세지 않고 retryAtMs 에 다시 돌린다. */
    | { kind: 'retry'; push: boolean; retryAtMs: number; attempt: number }
    | { kind: 'failure'; push: boolean; signature: string; failureClass: string; failures: number; disable: boolean };

/** PURE: 오류 → 서명. 분류 + 숫자·식별자를 지운 오류 문구 앞부분 — 요청 id 만 다른 같은 실패를 하나로 묶는다. */
export function failureSignature(error: string | null | undefined): string {
    const normalized = (error ?? '').toLowerCase().replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '#').replace(/\d+/g, '#')
        .replace(/\s+/g, ' ').trim().slice(0, AGENT_TASK_SCHEDULE.SIGNATURE_ERROR_CHARS);
    return `${classifyAgentTaskFailure(error)}:${normalized}`;
}

/** PURE: 종료 결과와 예약의 현재 기록으로 무엇을 할지 정한다. */
export function decideScheduleOutcome(
    state: ScheduleRunState, t: AgentTaskTerminalInfo, cfg: ScheduleOutcomeConfig,
): ScheduleOutcomeDecision {
    const silent = !!cfg.silentMarker && (t.result ?? '').trimStart().startsWith(cfg.silentMarker);
    if (t.status === 'completed') return { kind: 'success', push: !silent };
    const failureClass = classifyAgentTaskFailure(t.error);
    // 완료 판정(goal judge)이 표식뿐인 응답을 미달성으로 돌릴 수 있다 — 판정은 그대로 두고 알림만 생략하며, 예약의 실패로 세지도 않는다.
    if (silent && t.status === 'failed' && failureClass === 'goal_incomplete') return { kind: 'ignore', push: false };
    if (t.status !== 'failed' || SCHEDULE_UNCOUNTED_FAILURE_CLASSES.has(failureClass)) return { kind: 'ignore', push: true };
    const attempt = state.retryAttempt ?? 0;
    const delay = cfg.retryDelaysMs?.[attempt];
    if (delay !== undefined && t.totalTokens === 0 && SCHEDULE_UNREACHABLE_ERROR_RE.test(t.error ?? '')) {
        const retryAtMs = (cfg.nowMs ?? Date.now()) + delay;
        // 다음 정규 발화가 먼저 오면 그 발화가 곧 재실행이다.
        if (state.nextRunAtMs == null || retryAtMs < state.nextRunAtMs) return { kind: 'retry', push: false, retryAtMs, attempt: attempt + 1 };
    }
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
    cfg: ScheduleOutcomeConfig = {
        disableAfter: AGENT_TASK_SCHEDULE.RUN_FAILURE_DISABLE_AFTER,
        ...(AGENT_TASK_SCHEDULE.UNREACHABLE_RETRY_ENABLED ? { retryDelaysMs: AGENT_TASK_SCHEDULE.UNREACHABLE_RETRY_DELAYS_MS } : {}),
        ...(AGENT_TASK_SCHEDULE.SILENT_ENABLED ? { silentMarker: AGENT_TASK_SCHEDULE_SILENT_MARKER } : {}),
    },
): Promise<boolean> {
    try {
        const s = await repo.get(scheduleId);
        if (!s) return true;
        const next = s.next_run_at ? new Date(s.next_run_at).getTime() : NaN;
        const d = decideScheduleOutcome({
            consecutiveFailures: s.consecutive_failures ?? 0, lastFailureSignature: s.last_failure_signature ?? null,
            retryAttempt: s.retry_attempt ?? 0, nextRunAtMs: Number.isNaN(next) ? null : next,
        }, t, cfg);
        if (d.kind === 'success') {
            await repo.recordRunSuccess(scheduleId);
        } else if (d.kind === 'retry') {
            await repo.scheduleRetry(scheduleId, d.retryAtMs, d.attempt);
            logger.info(`[Schedule] 모델 미도달 — ${new Date(d.retryAtMs).toISOString()} 에 다시 실행(${d.attempt}회째): ${scheduleId}`);
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
        if (!d.push && d.kind !== 'failure' && d.kind !== 'retry') logger.info(`[Schedule] 보고할 것 없음 — 종료 알림 생략: ${scheduleId}`);
        return d.push;
    } catch (e) {
        logger.warn(`[Schedule] 실행 결과 반영 실패: ${scheduleId} — ${e instanceof Error ? e.message : e}`);
        return true;
    }
}
