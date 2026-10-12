/**
 * 모델 대기 (2026-10-13) — 모델 서버가 한동안 응답하지 못해도 작업을 실패시키지 않고 주차한다.
 *
 * 종전에는 일시적 모델 오류가 짧은 재시도(2회)와 소진 뒤 대기(최대 약 3분 45초)를 넘기면 작업이 failed(llm_error) 로 끝났다.
 * 예약 실행에는 5·15·30분 뒤 재실행이 있지만 사용자가 시작한 작업에는 없어, 모델 서버 재기동이 길어지면 사용자가 직접 이어 해야 했다.
 *
 * 새 상태를 만들지 않는다: `paused` + 주차 표식(agent_task_events.reason = model_wait) — 질문 응답 대기·기기 대기와 같은 장치다.
 * 주차된 작업은 실행을 끝내 대기열 자리를 반납하고, 부팅 복구·좀비 마킹은 건드리지 않는다.
 *
 * - 주차: 턴의 모델 호출이 끝내 모델 서버 쪽 오류로 실패했을 때(`parkForModelOutage`). 재개 지점은 그 턴 앞의 체크포인트이고,
 *   첫 턴이면 체크포인트가 없어 처음부터 다시 시작한다(아직 아무 일도 하지 않았다).
 * - 재개·만료: 전용 스윕(`sweepModelWaitTasks`)이 대기 중인 작업이 있을 때만 모델에 짧게 물어 보고(`probeAgentModel`),
 *   응답하면 재개하고, 상한(`MODEL_WAIT_MAX_MS`)을 넘기면 실패(model_wait_expired)로 끝낸다.
 *   주차 스윕(hitl-park)은 이 사유의 작업을 재개·만료하지 않는다.
 * - 예약(무인) 실행은 대상이 아니다 — 예약에는 자체 재실행 규칙이 있다(schedule-outcome).
 *
 * @module services/agent-task/model-wait
 */
import { getUnifiedDatabase, getPool } from '../../data/models/unified-database';
import { AgentTaskRepository } from '../../data/repositories/agent-task-repository';
import { AGENT_TASK_TURN_LOOP } from '../../config/agent-task-turn-loop';
import { AGENT_TASK_MODEL_WAIT_REASON } from '../../config/agent-task-park-reasons';
import { getModelForRole } from '../../config/model-roles';
import { createClient } from '../../llm';
import { getApprovalRegistry } from '../task-sandbox/approval-gate';
import { createLogger } from '../../utils/logger';
import { isModelOutageError } from './role-client';
import { AgentTaskAbort, AgentTaskParked } from './types';

const logger = createLogger('AgentTaskModelWait');

/** 모델이 돌아오지 않아 대기 상한을 넘긴 작업의 error 코드 — config/agent-task-failure-class 에서 llm_error 로 분류 */
export const AGENT_TASK_MODEL_WAIT_EXPIRED_ERROR = 'model_wait_expired';

/**
 * 턴의 모델 호출이 실패했을 때 — 모델 서버 쪽 사정이면 주차하고 AgentTaskParked 를 던진다. 그 밖에는 받은 오류를 그대로 던진다
 * (예산·토큰 상한·취소·서버 종료·모델 탓이 아닌 오류·무인 실행·기능 꺼짐). 항상 던진다.
 */
export async function parkForModelOutage(err: unknown, p: { taskId: string; signal: AbortSignal; update: (u: { status: 'paused' }) => Promise<void> }): Promise<never> {
    if (!AGENT_TASK_TURN_LOOP.MODEL_WAIT_ENABLED || p.signal.aborted || err instanceof AgentTaskAbort || !isModelOutageError(err)
        || getApprovalRegistry().isUnattended(p.taskId)) throw err;
    await p.update({ status: 'paused' });
    await new AgentTaskRepository(getPool()).markParked(p.taskId, AGENT_TASK_MODEL_WAIT_REASON);
    logger.warn(`[${p.taskId}] 모델 서버 응답 없음 — 모델 대기로 주차: ${err instanceof Error ? err.message : String(err)}`);
    throw new AgentTaskParked(AGENT_TASK_MODEL_WAIT_REASON);
}

/** PURE: 모델 대기 중인 작업을 스윕이 어떻게 다룰지. */
export function modelWaitAction(p: { modelUp: boolean; waitedMs: number; maxMs: number }): 'resume' | 'wait' | 'expire' {
    if (p.modelUp) return 'resume';
    return p.waitedMs > p.maxMs ? 'expire' : 'wait';
}

/**
 * 에이전트 모델이 지금 응답하는가 — 한 토큰짜리 호출로 확인한다. 절대 throw 하지 않는다.
 * 판단을 맡기는 호출이 아니라 상태 확인이다(LLM 판단 경계 A·B·C 형 어느 것도 아님). 대기 중인 작업이 있을 때만 불린다.
 */
export async function probeAgentModel(): Promise<boolean> {
    try {
        await createClient({ model: getModelForRole('agent') })
            .derive({ timeout: AGENT_TASK_TURN_LOOP.MODEL_WAIT_PROBE_TIMEOUT_MS, maxRetries: 0 })
            .chat([{ role: 'user', content: 'ping' }], { num_predict: 1 });
        return true;
    } catch {
        return false;
    }
}

/** 모델 대기 스윕(주기) — 모델이 응답하면 재개, 상한을 넘기면 실패. 대기 중인 작업이 없으면 모델을 확인하지 않는다. 절대 throw 하지 않는다. */
export async function sweepModelWaitTasks(): Promise<{ resumed: number; expired: number }> {
    const out = { resumed: 0, expired: 0 };
    let rows;
    try {
        rows = (await new AgentTaskRepository(getPool()).listParkedTasks()).filter((t) => t.reason === AGENT_TASK_MODEL_WAIT_REASON);
    } catch (e) {
        logger.warn(`모델 대기 작업 조회 실패(건너뜀): ${e instanceof Error ? e.message : e}`);
        return out;
    }
    if (rows.length === 0) return out;
    const modelUp = await probeAgentModel();
    // hitl-park 는 AgentTaskService 를 끌어온다 — 이 모듈은 실행 루프가 쓰므로 정적으로 묶지 않는다.
    const { resumeParkedTask } = await import('./hitl-park');
    for (const t of rows) {
        try {
            const action = modelWaitAction({ modelUp, waitedMs: Number(t.waited_ms ?? 0), maxMs: AGENT_TASK_TURN_LOOP.MODEL_WAIT_MAX_MS });
            if (action === 'resume') { if (await resumeParkedTask(t.id)) out.resumed++; continue; }
            if (action === 'expire') {
                await getUnifiedDatabase().updateAgentTask(t.id, { status: 'failed', error: AGENT_TASK_MODEL_WAIT_EXPIRED_ERROR, terminalNotifyPending: true });
                out.expired++;
            }
        } catch (e) {
            logger.warn(`[${t.id}] 모델 대기 처리 실패(다음 주기에 재시도): ${e instanceof Error ? e.message : e}`);
        }
    }
    if (out.resumed || out.expired) logger.info(`모델 대기 스윕 — 재개 ${out.resumed} · 만료 ${out.expired}`);
    return out;
}
