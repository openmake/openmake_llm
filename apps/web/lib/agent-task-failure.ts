/**
 * 에이전트 작업 실패 사유 — 원인 라벨과 다음 행동 문구의 번역 키를 정한다.
 *
 * 서버는 failed 작업마다 분류(`failure_class`, config/agent-task-failure-class 의 7종)를 남긴다.
 * 오류 코드로 남는 사유는 코드별 라벨을 쓰고, SDK·게이트웨이 문구처럼 자유 문구로 남는 사유는 분류 라벨을 쓴다.
 * 다음 행동 문구는 분류마다 하나다(코드에 따로 둔 것은 그것을 쓴다). 문구는 messages/*.json 의 `agentTasks.errorReason` 에 있다.
 */
export const FAILURE_CLASSES = ["goal_incomplete", "max_turns", "timeout", "token_limit", "llm_error", "interrupted", "unknown"] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

/** 번역 라벨이 있는 오류 코드 → 분류. 서버 분류표의 코드 대응과 같다("aborted" 는 사용자 취소라 분류가 없다). */
const CODE_CLASS: Readonly<Record<string, FailureClass | null>> = {
  goal_incomplete: "goal_incomplete",
  max_turns_exhausted: "max_turns",
  token_limit: "token_limit",
  timeout: "timeout",
  hitl_park_expired: "timeout",
  device_wait_expired: "timeout",
  interrupted: "interrupted",
  interrupted_local_device: "interrupted",
  sandbox_unavailable: "interrupted",
  aborted: null,
};
/** 같은 뜻의 다른 표기 — 서버가 재시작 정리 때 쓰는 문구를 번역 키로 맞춘다. */
const CODE_ALIASES: Readonly<Record<string, string>> = { "server restarted": "interrupted" };

/** 분류 라벨의 번역 키 — unknown 은 라벨 대신 원문을 보여 준다(원문이 유일한 단서다). */
const CLASS_LABEL: Readonly<Record<FailureClass, string | null>> = {
  goal_incomplete: "goal_incomplete",
  max_turns: "max_turns_exhausted",
  timeout: "timeout",
  token_limit: "token_limit",
  llm_error: "llm_error",
  interrupted: "interrupted",
  unknown: null,
};

const isClass = (v: unknown): v is FailureClass => (FAILURE_CLASSES as readonly unknown[]).includes(v);

/** 서버가 준 분류를 쓰고, 없거나 모르는 값이면 오류 코드로 정한다. 그것도 아니면 unknown. */
export function failureClassOf(error: string | undefined, serverClass?: string | null): FailureClass {
  if (isClass(serverClass)) return serverClass;
  const code = error ? (CODE_ALIASES[error] ?? error) : "";
  return CODE_CLASS[code] ?? "unknown";
}

/** 원인 라벨의 번역 키(agentTasks 기준). null 이면 번역이 없으니 원문을 보여 준다. */
export function failureLabelKey(error: string, serverClass?: string | null): string | null {
  const code = CODE_ALIASES[error] ?? error;
  if (code in CODE_CLASS) return `errorReason.${code}`;
  const label = isClass(serverClass) ? CLASS_LABEL[serverClass] : null;
  return label ? `errorReason.${label}` : null;
}

/** 분류의 문구가 맞지 않는 코드는 다음 행동 문구를 따로 둔다 — 실행 환경을 받지 못한 작업은 이어 할 지점이 없고,
 * 기기가 돌아오지 않아 끝난 작업은 시간 상한이 아니라 기기 연결이 문제다. */
const CODE_NEXT: Readonly<Record<string, string>> = { sandbox_unavailable: "sandbox_unavailable", device_wait_expired: "device_wait_expired" };

/** 다음 행동 문구의 번역 키(agentTasks 기준). */
export function failureNextKey(error: string, serverClass?: string | null): string {
  if (error in CODE_NEXT) return `errorReason.next.${CODE_NEXT[error]}`;
  return `errorReason.next.${failureClassOf(error, serverClass)}`;
}
