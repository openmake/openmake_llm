/**
 * 백그라운드 루프 생존 기록(R9-b) — 지난 소유권 점검·스케줄 tick·watchdog 가 마지막으로 돈 시각을 적어 두고,
 * readiness(GET /ready)가 주기의 3배 안에 돌았는지로 판정한다. 꺼진 루프는 보지 않는다.
 * 아직 한 번도 안 돌았으면 스케줄러가 그 루프를 등록한 시각부터 같은 기한을 준다(부팅 유예, #1478 — 모듈 import 시각이 아니다:
 * 부팅 복구가 길어 등록이 늦어도 등록 전에 기한이 지나지 않는다). 아직 등록 전인 루프는 판정하지 않는다. 프로세스 메모리에만 있다.
 *
 * @module services/agent-task/background-liveness
 */
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';

export type BackgroundLoop = 'lease_sweep' | 'schedule_tick' | 'watchdog';

export interface BackgroundLoopState { enabled: boolean; lastRunAt: string | null; staleAfterMs: number; ok: boolean }

/** 판정 기한 = 루프 주기 × 이 배수. */
const STALE_FACTOR = 3;

const registeredAt = new Map<BackgroundLoop, number>();
const lastRun = new Map<BackgroundLoop, number>();

/** 루프 설정은 호출 때 읽는다(환경 상수를 테스트가 바꿀 수 있다). */
function loopConfig(loop: BackgroundLoop): { enabled: boolean; periodMs: number } {
    switch (loop) {
        case 'lease_sweep': return { enabled: AGENT_TASK_LIMITS.LEASE_ENABLED, periodMs: AGENT_TASK_LIMITS.LEASE_SWEEP_MS };
        case 'schedule_tick': return { enabled: AGENT_TASK_LIMITS.SCHEDULES_ENABLED, periodMs: AGENT_TASK_LIMITS.SCHEDULE_TICK_MS };
        case 'watchdog': return { enabled: AGENT_TASK_LIMITS.WATCHDOG_ENABLED, periodMs: AGENT_TASK_LIMITS.WATCHDOG_MS };
    }
}

/** 스케줄러가 켜진 루프를 등록할 때 부른다 — 부팅 유예가 이 시각부터 시작한다. 등록이 도중에 실패해도 루프가 안 돌면 기한 뒤 readiness 가 잡는다. */
export function markLoopRegistered(loop: BackgroundLoop, at = Date.now()): void {
    registeredAt.set(loop, at);
}

/** 루프 진입 때 부른다 — 꺼짐·종료 중 검사보다 앞이라 "타이머가 살아 있다"는 뜻이다. */
export function markLoopRun(loop: BackgroundLoop, at = Date.now()): void {
    lastRun.set(loop, at);
}

export function getBackgroundLiveness(now = Date.now()): { ok: boolean; loops: Record<BackgroundLoop, BackgroundLoopState> } {
    const state = (loop: BackgroundLoop): BackgroundLoopState => {
        const { enabled, periodMs } = loopConfig(loop);
        const staleAfterMs = STALE_FACTOR * periodMs;
        const at = lastRun.get(loop);
        const since = at ?? registeredAt.get(loop);
        const ok = !enabled || since === undefined || now - since < staleAfterMs;
        return { enabled, lastRunAt: at === undefined ? null : new Date(at).toISOString(), staleAfterMs, ok };
    };
    const loops = { lease_sweep: state('lease_sweep'), schedule_tick: state('schedule_tick'), watchdog: state('watchdog') };
    return { ok: loops.lease_sweep.ok && loops.schedule_tick.ok && loops.watchdog.ok, loops };
}

/** 테스트용 — 실행·등록 기록을 지운다. */
export function resetBackgroundLiveness(): void {
    lastRun.clear();
    registeredAt.clear();
}
