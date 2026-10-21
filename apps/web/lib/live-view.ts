/**
 * 실시간 작업 화면(작업 상세 오른쪽 패널) 폴링 판단 — 순수 함수.
 * 조회는 components/agent-tasks/live-view 가 한다. 백엔드: routes/agent-task-live.routes.ts
 * 상수는 상대 경로로 가져온다 — api Jest 가 이 파일을 직접 require 하는데 거기서 `@/` 는 api src 를 가리킨다.
 */
import { LIVE_VIEW_POLL_MS } from "./constants/ui-limits";

/** 화면을 계속 다시 읽는 작업 상태. */
export const LIVE_RUNNING_STATUSES: readonly string[] = ["running", "paused"];

/** 화면이 이보다 덜 지났으면 "지금"으로 본다(초). */
const FRESH_FRAME_SECONDS = 3;

/** 다음 폴링까지 ms, 멈추면 null. 실행 중이 아니면 null(끝난 작업은 컴포넌트가 처음 한 번만 읽는다). */
export function nextLivePollDelay(s: { status: string | undefined; visible: boolean; eligible: boolean | null }): number | null {
  if (s.eligible === false || !s.visible) return null;
  if (!s.status || !LIVE_RUNNING_STATUSES.includes(s.status)) return null;
  return LIVE_VIEW_POLL_MS;
}

/** 프레임이 몇 초 전 것인지 — 3초 미만이면 null("지금"으로 본다). */
export function frameAgeSeconds(at: number, now: number): number | null {
  const seconds = Math.floor((now - at) / 1000);
  return seconds < FRESH_FRAME_SECONDS ? null : seconds;
}

/** 조회 오류 중 패널을 숨길 것 — 403(소유자·관리자 아님)·404(작업 없음). 그 밖(5xx·네트워크·재기동)은 일시 오류로 보고 다음 폴링에서 다시 읽는다. */
const HIDDEN_ERROR_STATUSES: ReadonlySet<number> = new Set([403, 404]);

export function isLiveViewHiddenError(status: number | undefined): boolean {
  return status !== undefined && HIDDEN_ERROR_STATUSES.has(status);
}
