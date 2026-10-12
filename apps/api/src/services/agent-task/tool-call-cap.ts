/**
 * 도구 호출 공통 시간 상한 — 호스트(내장)·외부 도구 한 번의 호출을 기다리는 시간의 안전판.
 *
 * 샌드박스 명령(TASK_SANDBOX_EXEC_TIMEOUT_MS)·외부 MCP 도구(MCP_EXTERNAL_TOOL_TIMEOUT_MS)에는 상한이 있지만 내장 도구는
 * 핸들러마다 제각각이고 공통 상한이 없었다. 작업의 시간 예산은 턴 사이와 모델 호출에서만 검사하고 실행 소유권 연장은
 * 루프 진행과 무관한 타이머라, 도구 하나가 끝나지 않으면 작업이 running 으로 무기한 남았고 취소·서버 종료도 그 호출이
 * 끝나기를 기다렸다.
 *
 * - 상한을 넘기면 기다리기를 멈추고 onTimeout 의 값을 결과로 돌려준다(도구 자체를 중단시키지는 못한다 — 뒤늦게 끝날 수 있다).
 * - 사용자 입력을 기다리는 동안(외부 도구의 질문)은 세지 않는다 — 대기가 끝나면 새 창으로 다시 센다.
 * - 중단 신호(사용자 취소·서버 종료·소유권 상실)가 오면 호출이 끝나기를 기다리지 않고 AgentTaskAbort 를 던진다.
 * - capMs 가 0 이하면 시간으로는 끊지 않는다(중단 신호만 본다).
 *
 * @module services/agent-task/tool-call-cap
 */
import { AgentTaskAbort } from './types';

interface ToolCallCapOptions<T> {
    capMs: number;
    signal: AbortSignal;
    /** 지금 사용자 입력을 기다리는 중인가 — 그동안은 상한을 세지 않는다 */
    isWaitingForUser: () => boolean;
    /** 상한을 넘겼을 때 호출 결과로 쓸 값 */
    onTimeout: () => T;
}

export function runWithToolCallCap<T>(run: () => Promise<T>, opts: ToolCallCapOptions<T>): Promise<T> {
    const { capMs, signal } = opts;
    if (signal.aborted) return Promise.reject(new AgentTaskAbort('aborted'));
    return new Promise<T>((resolve, reject) => {
        let timer: NodeJS.Timeout | undefined;
        const onAbort = (): void => { cleanup(); reject(new AgentTaskAbort('aborted')); };
        const cleanup = (): void => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); };
        const arm = (): void => {
            timer = setTimeout(() => {
                if (opts.isWaitingForUser()) return arm();
                cleanup();
                resolve(opts.onTimeout());
            }, capMs);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        if (capMs > 0) arm();
        run().then((v) => { cleanup(); resolve(v); }, (e) => { cleanup(); reject(e); });
    });
}
