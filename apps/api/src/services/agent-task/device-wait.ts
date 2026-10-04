/**
 * 기기 대기 (Companion P1-4, 2026-10-04) — 로컬 실행 작업이 쓸 기기가 없을 때 실패시키지 않고 주차한다.
 *
 * 새 상태를 만들지 않는다: `paused` + 주차 표식(agent_task_events.reason = device_wait). 질문 응답 대기 주차(F16.7,
 * hitl-park)와 같은 장치를 쓴다 — 주차된 작업은 실행을 끝내 대기열 자리를 반납하고, 부팅 복구·좀비 마킹은 건드리지 않는다.
 *
 * - 시작 시점: 실행기를 준비하지 못했으면(`LocalDeviceUnavailableError`) `parkForMissingDevice` 가 주차한다. 체크포인트가 없어
 *   재개는 처음부터 다시 시작한다(아직 아무 턴도 돌지 않았다).
 * - 실행 도중: turn-executor 가 실행기의 기기 유실 신호(`consumeDeviceLoss`)를 보고 체크포인트 후 주차한다.
 * - 재개: 기기가 등록되면 즉시(`resumeDeviceWaitingTasks`), 놓친 것은 주차 스윕이 다시 시도한다. 상한
 *   (`LOCAL_BRIDGE.DEVICE_WAIT_MAX_MS`)을 넘기면 실패로 끝낸다.
 *
 * @module services/agent-task/device-wait
 */
import { getPool } from '../../data/models/unified-database';
import { AgentTaskRepository } from '../../data/repositories/agent-task-repository';
import { AgentTaskParkRepository } from '../../data/repositories/agent-task-park-repository';
import { LOCAL_BRIDGE } from '../../config/local-bridge';
import { LocalDeviceUnavailableError } from '../local-bridge/device-errors';
import { createLogger } from '../../utils/logger';
import { AgentTaskParked, AGENT_TASK_DEVICE_WAIT_REASON } from './types';

const logger = createLogger('AgentTaskDeviceWait');

/** 기기를 기다리다 상한을 넘겨 끝난 작업의 error 코드 */
export const AGENT_TASK_DEVICE_WAIT_EXPIRED_ERROR = 'device_wait_expired';

/** PURE: 기기 대기 중인 작업을 스윕이 어떻게 다룰지. */
export function deviceWaitAction(p: { connected: boolean; waitedMs: number; maxMs: number }): 'resume' | 'wait' | 'expire' {
    if (p.connected) return 'resume';
    return p.waitedMs > p.maxMs ? 'expire' : 'wait';
}

/**
 * 작업 시작 시점 — 실행기 준비가 "기기 없음"으로 실패했으면 주차한다(던진다). 그 밖의 오류·기능 꺼짐이면 아무것도 하지 않고
 * 돌아가 호출부가 종전 처리(실행 환경 없이 진행)를 잇는다.
 */
export async function parkForMissingDevice(err: unknown, p: { taskId: string; update: (u: { status: 'paused' }) => Promise<void> }): Promise<void> {
    if (!LOCAL_BRIDGE.DEVICE_WAIT_ENABLED || !(err instanceof LocalDeviceUnavailableError)) return;
    await p.update({ status: 'paused' });
    await new AgentTaskRepository(getPool()).markParked(p.taskId, AGENT_TASK_DEVICE_WAIT_REASON);
    logger.info(`[${p.taskId}] 로컬 기기 미연결 — 기기 대기로 주차`);
    throw new AgentTaskParked(AGENT_TASK_DEVICE_WAIT_REASON);
}

/**
 * 기기가 등록된 직후 — 그 사용자의 기기 대기 작업을 재개한다. 절대 throw 하지 않는다(등록 흐름을 흔들지 않는다).
 * 작업이 특정 기기를 지정했으면 그 기기일 때만 재개하고(resumeParkedTask 가 판단), 나머지는 스윕이 다시 본다.
 */
export async function resumeDeviceWaitingTasks(userId: string): Promise<number> {
    if (!LOCAL_BRIDGE.DEVICE_WAIT_ENABLED) return 0;
    let resumed = 0;
    try {
        const ids = await new AgentTaskParkRepository(getPool()).listDeviceWaitTaskIds(userId);
        if (ids.length === 0) return 0;
        // hitl-park 는 AgentTaskService 를 끌어온다 — 등록 경로(소켓)에서 정적으로 묶지 않는다.
        const { resumeParkedTask } = await import('./hitl-park');
        for (const id of ids) {
            try {
                if (await resumeParkedTask(id)) resumed++;
            } catch (e) {
                logger.warn(`[${id}] 기기 대기 재개 실패(스윕이 다시 시도): ${e instanceof Error ? e.message : e}`);
            }
        }
        if (resumed) logger.info(`기기 재연결 — 사용자 ${userId} 의 대기 작업 ${resumed}건 재개`);
    } catch (e) {
        logger.warn(`기기 대기 작업 조회 실패(스윕이 다시 시도): ${e instanceof Error ? e.message : e}`);
    }
    return resumed;
}
