/**
 * 오케스트레이터 작업 배너 표시 규칙(순수 함수) — 실패 분류는 서버가 이벤트 reason·provider 로 보내고,
 * 웹은 문구가 있는 코드만 `chat.orchestrator.failure.<key>` 로 바꾼다. 그 밖은 서버 summary 원문을 그린다.
 */

/** 문구가 있는 실패 코드 → 문구 키. cancelled·failed·input·quota 등은 원문 summary 가 더 구체적이라 두지 않는다 */
const FAILURE_KEYS: Record<string, string> = {
  timeout: "timeout",
  unassigned: "unassigned",
  unsupported: "unavailable",
  disabled: "unavailable",
  skipped: "skipped",
  deadline: "deadline",
};

/** 실패 reason(·외부 provider) → 문구 키. 문구가 없는 코드·reason 없음(옛 서버)은 null */
export function orchestratorFailureMessage(reason?: string, provider?: string): { key: string; provider?: string } | null {
  const key = reason && Object.hasOwn(FAILURE_KEYS, reason) ? FAILURE_KEYS[reason] : undefined;
  if (!key) return null;
  if (key === "timeout" && provider) return { key: "timeoutExternal", provider };
  return { key };
}

/** 경과 시간(ms) → m:ss */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** 실행 중 작업이 하나라도 있는가 — 1초 타이머를 돌릴지 */
export function hasRunningTask(tasks: ReadonlyArray<{ status: string }>): boolean {
  return tasks.some((t) => t.status === "running");
}
