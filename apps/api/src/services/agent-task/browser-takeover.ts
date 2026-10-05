/**
 * 브라우저 넘겨받기 주차 (2026-10-05) — 사용자가 Companion 에서 브라우저를 넘겨받은 동안 작업이 실행 자리를 잡고 있지 않게 한다.
 *
 * 기기 대기(device-wait)와 같은 장치를 쓴다: `paused` + 주차 표식(agent_task_events.reason = browser_takeover).
 * - 주차: 기기가 브라우저 요청을 넘겨받기 때문에 거절하면 결과에 표식(userControl)을 싣는다. 실행기가 그것을 기억하고
 *   (RemoteExecutor.consumeDeviceLoss = 'browser_takeover') 턴 실행기가 결과 없이 체크포인트 후 주차한다(LOCAL_BRIDGE.TAKEOVER_PARK_ENABLED).
 * - 재개: 기기가 제어권을 돌려줄 때 보내는 bridge_event(browser_control, user=false)를 받으면 `resumeBrowserTakeoverTasks`,
 *   알림을 놓친 것은 주차 스윕(hitl-park)이 다시 시도한다. 재개된 작업은 같은 브라우저 호출을 다시 실행한다.
 * - 상한: `LOCAL_BRIDGE.TAKEOVER_WAIT_MAX_MS` 를 넘기면 실패(browser_takeover_expired)로 끝낸다.
 *
 * @module services/agent-task/browser-takeover
 */
import { getPool } from '../../data/models/unified-database';
import { AgentTaskParkRepository } from '../../data/repositories/agent-task-park-repository';
import { AGENT_TASK_BROWSER_TAKEOVER_REASON } from '../../config/agent-task-park-reasons';
import { getLocalBridgeRegistry } from '../local-bridge/registry';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskBrowserTakeover');

/** 넘겨받기를 기다리다 상한을 넘겨 끝난 작업의 error 코드 */
export const AGENT_TASK_BROWSER_TAKEOVER_EXPIRED_ERROR = 'browser_takeover_expired';

/**
 * PURE: 넘겨받기로 주차된 작업을 어떻게 다룰지. 기기가 연결돼 있고 넘겨받은 상태가 아니면(돌려줬거나 알림을 받은 적 없음) 재개를
 * 시도한다 — 여전히 넘겨받은 상태면 실행기가 다시 주차한다. 그 밖에는 상한까지 기다린다.
 */
export function browserTakeoverAction(p: { connected: boolean; userControl: boolean; waitedMs: number; maxMs: number }): 'resume' | 'wait' | 'expire' {
    if (p.connected && !p.userControl) return 'resume';
    return p.waitedMs > p.maxMs ? 'expire' : 'wait';
}

/**
 * 기기가 제어권을 돌려준 직후 — 그 사용자의 넘겨받기 주차 작업 중 지정 기기가 넘겨받은 상태가 아닌 것을 재개한다.
 * 절대 throw 하지 않는다(소켓 메시지 처리를 흔들지 않는다). 실패한 것은 주차 스윕이 다시 본다.
 */
export async function resumeBrowserTakeoverTasks(userId: string): Promise<number> {
    let resumed = 0;
    try {
        const rows = await new AgentTaskParkRepository(getPool()).listParkedTaskIdsByReason(userId, AGENT_TASK_BROWSER_TAKEOVER_REASON);
        if (rows.length === 0) return 0;
        // hitl-park 는 AgentTaskService 를 끌어온다 — 소켓 경로에서 정적으로 묶지 않는다.
        const { resumeParkedTask } = await import('./hitl-park');
        const registry = getLocalBridgeRegistry();
        for (const row of rows) {
            const dev = registry.getDevice(userId, row.device_id ?? undefined);
            if (!dev || dev.browserUserControl === true) continue; // 다른 PC 가 아직 넘겨받은 상태 — 그대로 둔다
            try {
                if (await resumeParkedTask(row.id)) resumed++;
            } catch (e) {
                logger.warn(`[${row.id}] 넘겨받기 대기 재개 실패(스윕이 다시 시도): ${e instanceof Error ? e.message : e}`);
            }
        }
        if (resumed) logger.info(`브라우저 제어권 반환 — 사용자 ${userId} 의 대기 작업 ${resumed}건 재개`);
    } catch (e) {
        logger.warn(`넘겨받기 대기 작업 조회 실패(스윕이 다시 시도): ${e instanceof Error ? e.message : e}`);
    }
    return resumed;
}
