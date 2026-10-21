/**
 * 시험 헬퍼 — 조건이 채워질 때까지 짧게 반복해서 기다린다.
 * 승인 대기 등록은 저장소(DB)가 붙으면 takeoverForCall·insertPending 쿼리 뒤에 일어나서
 * "한 틱 양보"로는 보장되지 않는다(dev CI 실제 Postgres). 등록을 직접 확인하며 기다린다.
 */

/** 기다림 상한(ms) — 넘으면 무엇을 기다렸는지 밝히며 실패한다. 시험 기본 제한 시간(10초)보다 짧게. */
export const WAIT_FOR_TIMEOUT_MS = 5000;
/** 다시 확인하는 간격(ms). */
const WAIT_FOR_INTERVAL_MS = 5;

/** get() 이 참 같은 값을 돌려줄 때까지 기다려 그 값을 돌려준다. */
export async function waitFor<T>(get: () => T | undefined | null | '' | false, label: string, timeoutMs = WAIT_FOR_TIMEOUT_MS): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const v = get();
        if (v) return v as T;
        if (Date.now() >= deadline) throw new Error(`${label} — ${timeoutMs}ms 안에 준비되지 않았습니다`);
        await new Promise((r) => setTimeout(r, WAIT_FOR_INTERVAL_MS));
    }
}
