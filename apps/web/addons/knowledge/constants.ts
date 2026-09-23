/**
 * Knowledge add-on(웹) UI 상수 — 서버 정책값(파일 크기·MIME)은 GET /api/knowledge/capabilities 가 준다.
 * 여기 있는 것은 순수 UI 값(사이드바 표시 개수·폴링 주기)뿐이다(No-Hardcoding: 매직 넘버 금지).
 */

/** 서버 add-on id (`GET /api/addons` 의 enabled 판정 · WebAddon.id) */
export const KNOWLEDGE_ADDON_ID = "knowledge-runtime";

/** 사이드바 섹션에 접힌 채로 보이는 최대 Space 수(최근 사용순). 넘치면 "모든 Knowledge 보기"로. */
export const SIDEBAR_MAX_SPACES = 6;

/** 문서가 처리 중일 때만 상세 화면이 상태를 다시 읽는 주기(ms) — ready/failed 만 남으면 멈춘다. */
export const PROCESSING_POLL_MS = 4000;

/** "기존 대화 추가" 선택기가 불러오는 최근 대화 개수. */
export const BIND_PICKER_RECENT_LIMIT = 30;

/** react-query 키 — 전부 ["knowledge", ...] 네임스페이스로 격리한다. */
export const qk = {
  capabilities: () => ["knowledge", "capabilities"] as const,
  spaces: () => ["knowledge", "spaces"] as const,
  space: (id: string) => ["knowledge", "space", id] as const,
  binding: (sessionId: string) => ["knowledge", "binding", sessionId] as const,
  chunk: (spaceId: string, chunkId: string) => ["knowledge", "chunk", spaceId, chunkId] as const,
  adminStatus: () => ["knowledge", "admin", "status"] as const,
  adminProfiles: () => ["knowledge", "admin", "profiles"] as const,
};
