/**
 * 세션 메시지를 store 에 싣는 공용 로더 (F08 PR-6) — 분기(clone) 직후 새 세션으로 전환할 때 사용.
 * 사이드바·히스토리의 기존 로더와 같은 매핑(+ dbId: 분기 기준점 선택용 DB 메시지 id).
 */
import type { ApiSuccess, ChatRole, SearchSourceRef } from "@openmake/shared-types";
import { ApiClient } from "./api-client";
import { appendAnonSessionId } from "./anon-session";
import { useAppStore } from "./store";

interface WireMessage { id?: string | number; role: string; content: string; images?: string[]; thinking?: string; reasoningSummary?: string; sources?: SearchSourceRef[] }

export async function loadSessionIntoStore(sid: string): Promise<void> {
  const st = useAppStore.getState();
  st.setArtifacts([]);
  st.setCurrentSessionId(sid);
  st.setNotebookContext(null);
  try {
    const res = await ApiClient.get<ApiSuccess<{ messages?: WireMessage[] }>>(appendAnonSessionId(`/api/chat/sessions/${sid}/messages`));
    const msgs = res?.data?.messages ?? [];
    st.setChatHistory(() =>
      msgs
        .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
        .map((m) => ({
          role: m.role as ChatRole,
          content: m.content,
          images: m.images,
          reasoning: m.thinking || undefined,
          reasoningSummary: m.reasoningSummary || undefined,
          ...(m.sources?.length ? { sources: m.sources } : {}),
          dbId: m.id !== undefined ? String(m.id) : undefined,
        })),
    );
  } catch {
    /* 조회 실패 — 빈 히스토리 유지 */
  }
}
