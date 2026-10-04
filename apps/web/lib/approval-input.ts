/**
 * 승인·질문 카드의 입력 판정 — 순수 함수(화면 두 곳: 채팅 인라인 카드, 승인함)가 같이 쓴다.
 * 테스트는 apps/api/src/__tests__/web/approval-input.test.ts.
 */

interface EnterKeyLike {
  key: string;
  shiftKey?: boolean;
  /** 한글 등 조합 입력 중인가(KeyboardEvent.isComposing). */
  isComposing?: boolean;
  /** 229 는 isComposing 이 false 로 오는 WebKit 조합 커밋 보강. */
  keyCode?: number;
}

/** WebKit 이 조합 중 키에 주는 keyCode. */
const IME_KEYCODE = 229;

/** 이 키 입력으로 답변을 전송할까 — Enter 만, 조합 중은 제외. 여러 줄 입력란은 Shift+Enter 가 줄바꿈이다(채팅 입력창과 같은 규칙). */
export function shouldSubmitOnEnter(e: EnterKeyLike, opts: { multiline?: boolean } = {}): boolean {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === IME_KEYCODE) return false;
  return !(opts.multiline && e.shiftKey);
}

/**
 * "나머지 모두 승인" 뒤에 화면에 남길 카드 — 계속 물어야 하는 호출(외부 MCP·지시 파일·메모리 쓰기)은 서버에 대기로 남는다.
 * 대기 목록을 못 받았으면 카드를 그대로 둔다(승인할 곳을 화면에서 지우지 않는다).
 */
export function keepStillPending<T extends { approvalId: string }>(
  cards: T[],
  pending: ReadonlyArray<{ approvalId: string }> | null | undefined,
): T[] {
  if (!pending) return cards;
  const still = new Set(pending.map((p) => p.approvalId));
  return cards.filter((c) => still.has(c.approvalId));
}

const TASK_STATUSES: ReadonlySet<string> = new Set(["pending", "queued", "running", "paused", "completed", "failed", "cancelled"]);

/** 작업 상태 원값 → 번역 키(agentTasks 네임스페이스). 모르는 상태는 null — 호출부가 원값을 그대로 보인다. */
export function taskStatusLabelKey(status: string): string | null {
  return TASK_STATUSES.has(status) ? `statusRaw.${status}` : null;
}
