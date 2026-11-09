/**
 * 대화 읽기 전용 공유 API 계약 (198, 2026-11-09).
 *
 *   GET    /api/sessions/:sessionId/share          — 공유 상태 + 서버가 계산한 선택지(소유자)
 *   POST   /api/sessions/:sessionId/share/preview  — 서버 보관 미리보기 생성(소유자)
 *   POST   /api/sessions/:sessionId/share          — 확인한 미리보기를 게시(소유자)
 *   DELETE /api/sessions/:sessionId/share          — 공유 해제(소유자, 멱등)
 *   GET    /api/shared-conversations/:shareId      — 공유본 조회(서버 인가, 거절은 모두 404)
 *
 * 응답은 공통 `{ success, data }` 봉투 안의 data 모양이다. 공유 문서는 게시 시점에 고정된 사본이며
 * 실제 세션·메시지 ID, 모델·키 이름, 첨부·도구·승인 데이터, 사고 과정(thinking)을 담지 않는다.
 */

/** 공개 범위 — org 는 소유자가 고른 조직 한 곳의 현재 멤버만. */
export type ConversationShareVisibility = "private" | "authenticated" | "link" | "org";

export const CONVERSATION_SHARE_VISIBILITIES: readonly ConversationShareVisibility[] = [
  "private",
  "authenticated",
  "link",
  "org",
];

export interface ConversationShareMessageV1 {
  role: "user" | "assistant";
  content: string;
}

/** 공유 문서 v1 — 제목과 본문만. */
export interface ConversationShareDocumentV1 {
  schemaVersion: 1;
  title: string;
  messages: ConversationShareMessageV1[];
}

/** 소유자에게 보이는 현재 공유 상태. link 의 토큰은 path 에만 실린다. */
export interface ConversationShareState {
  shareId: string;
  visibility: ConversationShareVisibility;
  orgId: string | null;
  revision: number;
  capturedAt: string;
  updatedAt: string;
  /** 같은 origin 의 공유 페이지 경로(`/shared/conversation/<id>` + link 면 `?token=`). */
  path: string;
}

export interface ConversationShareOrganizationOption {
  orgId: string;
  name: string;
}

/** 서버가 현재 멤버십으로 계산한 선택지 — 화면은 이 값을 그대로 보여 줄 뿐 다시 계산하지 않는다. */
export interface ConversationShareCapabilities {
  canShare: true;
  allowedVisibilities: ConversationShareVisibility[];
  organizations: ConversationShareOrganizationOption[];
}

export interface ConversationShareStatusResponse {
  share: ConversationShareState | null;
  capabilities: ConversationShareCapabilities;
}

export interface ConversationSharePreviewRequest {
  visibility?: ConversationShareVisibility;
  /** visibility 가 org 일 때만 필수, 그 밖에는 보내면 400. */
  orgId?: string;
}

export interface ConversationSharePreviewResponse {
  previewId: string;
  document: ConversationShareDocumentV1;
  capturedAt: string;
  expiresAt: string;
  visibility: ConversationShareVisibility;
  orgId: string | null;
  /** 미리보기를 만들 때의 공유 revision(공유 없음=0). 그 사이 다른 게시가 있으면 게시가 409. */
  baseRevision: number;
}

export interface ConversationSharePublishRequest {
  previewId: string;
  confirmed: true;
}

export type ConversationSharePublishResponse = ConversationShareState;

export interface ConversationShareRevokeResponse {
  unshared: boolean;
}

/** 공유본 조회 응답 — 소유자·원본 정보 없음. */
export interface SharedConversationView {
  shareId: string;
  visibility: ConversationShareVisibility;
  capturedAt: string;
  updatedAt: string;
  document: ConversationShareDocumentV1;
}

/** 오류 응답의 error.code — 화면이 사유별 안내를 고르는 데 쓴다. */
export const CONVERSATION_SHARE_ERROR_CODES = {
  /** 저장된 메시지가 없다(422). */
  EMPTY: "CONVERSATION_SHARE_EMPTY",
  /** 메시지 수·문서 크기 한도 초과(413). */
  TOO_LARGE: "CONVERSATION_SHARE_TOO_LARGE",
  /** 미리보기가 없거나 만료·이미 쓰였거나 그 사이 다른 게시가 있었다(409) — 다시 미리보기. */
  PREVIEW_STALE: "CONVERSATION_SHARE_PREVIEW_STALE",
} as const;
