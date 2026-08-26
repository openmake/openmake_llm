/**
 * 에이전트 작업 공유 — 웹 공통 타입·호출.
 *
 * 소유자 패널(`components/agent-tasks/share-panel.tsx`)과 공개 뷰어
 * (`app/shared/task/[shareId]`)가 같은 계약을 쓰도록 한 곳에 둔다.
 *
 * 서버 계약: `apps/api/src/services/agent-task/share-document.ts`.
 * 공유 문서는 원본 작업이 아니라 **선별·정화된 사본**이며 게시 시점에 고정된 스냅샷이다.
 */
import { ApiClient } from "@/lib/api-client";
import type { ApiSuccess } from "@openmake/shared-types";

export type ShareVisibility = "private" | "authenticated" | "link";

export interface ShareDocument {
  taskId: string;
  goal: string;
  result: string;
  status: string;
  summary: { turns: number; toolCalls: number; retries: number; diffs: number; artifacts: number };
  steps: { n: number; type: string; tool?: string; text: string }[];
  diffs: string[];
  artifacts: {
    id: string; title: string; kind: string; body: string | null;
    omitted?: "markup" | "unparsable";
    /** 격리 오리진 뷰어가 있는 산출물 — URL 은 열 때 발급받는다(스냅샷에 토큰을 담지 않는다) */
    viewerId?: string;
  }[];
  createdAt: string | null;
  completedAt: string | null;
}

export interface ShareState {
  shareId: string;
  visibility: ShareVisibility;
  shareToken: string | null;
  includeSteps: boolean;
  includeDiff: boolean;
  includeArtifacts: boolean;
  sharedAt?: string;
  path: string;
}

export interface ShareToggles {
  includeSteps: boolean;
  includeDiff: boolean;
  includeArtifacts: boolean;
}

export const getShareState = (taskId: string) =>
  ApiClient.get<ApiSuccess<{ share: ShareState | null }>>(`/api/agent-tasks/${taskId}/share`);

export const previewShare = (taskId: string, toggles: ShareToggles) =>
  ApiClient.post<ApiSuccess<{ preview: ShareDocument }>>(`/api/agent-tasks/${taskId}/share/preview`, toggles);

export const publishShare = (taskId: string, body: ShareToggles & { visibility: ShareVisibility }) =>
  ApiClient.post<ApiSuccess<ShareState>>(`/api/agent-tasks/${taskId}/share`, body);

export const unshareTask = (taskId: string) =>
  ApiClient.del<ApiSuccess<{ unshared: boolean }>>(`/api/agent-tasks/${taskId}/share`);

/**
 * 산출물 열람 URL 발급 — 공유와 같은 인가를 통과해야 받는다. 토큰 TTL 이 있어
 * 스냅샷에 박아두지 않는다(한 번 본 사람이 영구 URL 을 갖지 않도록).
 */
export const openSharedArtifact = (shareId: string, index: number, token: string | null) =>
  ApiClient.get<ApiSuccess<{ url: string }>>(
    `/api/shared-tasks/${shareId}/artifacts/${index}/open${token ? `?token=${encodeURIComponent(token)}` : ""}`,
    { redirectOnUnauthorized: false },
  );

/**
 * 공개 조회 — 비로그인 방문자가 대상이므로 401 리다이렉트를 끈다.
 * (서버는 권한 실패도 404 로 응답한다 — 존재 은닉)
 */
export const getSharedTask = (shareId: string, token: string | null) =>
  ApiClient.get<ApiSuccess<{ shareId: string; visibility: ShareVisibility; sharedAt: string; document: ShareDocument }>>(
    `/api/shared-tasks/${shareId}${token ? `?token=${encodeURIComponent(token)}` : ""}`,
    { redirectOnUnauthorized: false },
  );
