/**
 * @module lib/constants/ui-limits
 * @description apps/web 공용 UI 타이밍 상수 (No-Hardcoding L2).
 * 인라인 매직 넘버 대신 여기의 명명 상수를 쓴다 — 값 변경은 동작에 직접 영향한다.
 */

/** 클립보드 복사 후 "복사됨" 배지를 되돌리기까지 대기(ms). */
export const COPY_FEEDBACK_RESET_MS = 1500;

/** diff 코드블록 복사 피드백 리셋 대기(ms). */
export const DIFF_COPY_FEEDBACK_RESET_MS = 2000;

/** 공유 링크 복사 피드백 리셋 대기(ms). */
export const SHARE_LINK_COPY_RESET_MS = 1600;

/** 스티어링 입력 "전송됨" 표시 리셋 대기(ms). */
export const STEERING_SENT_RESET_MS = 2500;

/** 슬래시 명령 자동완성 debounce(ms). */
export const SLASH_COMMAND_DEBOUNCE_MS = 150;

/** 에이전트 작업 상세 폴링 주기(ms). */
export const AGENT_TASK_DETAIL_POLL_MS = 2500;

/** 승인·재시도 등 액션 후 작업 목록 재조회 지연(ms). */
export const AGENT_TASK_REFRESH_DELAY_MS = 2000;

/** Blob object URL 해제까지 대기(ms) — 다운로드 트리거 후 정리. */
export const OBJECT_URL_REVOKE_DELAY_MS = 1000;
