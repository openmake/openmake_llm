/**
 * 에이전트 작업의 worktree 격리 상태 계약 (200, 2026-11-16).
 *
 * 로컬 실행(로컬 브리지)에서 서버가 작업 시작 때 정해 `agent_tasks.isolation` 에 남기고, 작업 응답
 * (`GET /api/agent-tasks/:id` 의 `task.isolation`)과 진행 이벤트(`agent_task_progress.isolation`)로 내려준다.
 * 화면은 값 → 문구 대응만 한다. NULL·없음 = 해당 없음(샌드박스 실행, 옛 행).
 *
 *   worktree : 작업 폴더(`worktreeRel`, 실행 폴더(연결 폴더 + folder_rel) 기준 상대경로)·브랜치에서 격리 실행.
 *              outcome 은 작업이 끝난 뒤(종료 상태에서만) 정리 결과 — kept = 변경이 남아 보존, removed = 변경 없어 정리.
 *   direct   : 격리 없이 연결 폴더에서 직접 작업. reason —
 *              not_repo = git 저장소가 아님, disabled = 서버 설정으로 꺼짐, unavailable = 격리를 시도했으나 실패.
 */
export type AgentTaskIsolation =
  | { state: "worktree"; branch: string; worktreeRel: string; outcome?: "kept" | "removed" }
  | { state: "direct"; reason: "not_repo" | "disabled" | "unavailable" };
