"use client";

/**
 * Knowledge 화면(사이드바 밖: 목록·상세)에서 대화를 여는 동작 — 사이드바의 openSession 과 같은 절차를
 * 재현한다(아티팩트 비움 → 세션 지정 → contextRefs 리셋 → 메시지 로드 → 채팅으로 전환).
 * 새 대화는 서버가 만든 sessionId 를 현재 세션으로 세팅해, 다음 WS 채팅 메시지가 그 세션으로 실려 가게 한다
 * (use-chat-socket 은 전송 시 store.currentSessionId 를 읽는다).
 */
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { ApiSuccess, SearchSourceRef } from "@openmake/shared-types";
import { useAppStore } from "@/lib/store";
import type { ChatRole } from "@/lib/store";
import { ApiClient } from "@/lib/api-client";
import { appendAnonSessionId } from "@/lib/anon-session";
import { knowledgeApi } from "./api";

interface LoadedMessage {
  id?: string | number;
  role: string;
  content: string;
  images?: string[];
  thinking?: string;
  reasoningSummary?: string;
  sources?: SearchSourceRef[];
}

export function useSessionActions() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const openSession = async (sessionId: string) => {
    const s = useAppStore.getState();
    s.setArtifacts([]);
    s.setCurrentSessionId(sessionId);
    s.clearContextRefs();
    try {
      const res = await ApiClient.get<ApiSuccess<{ messages?: LoadedMessage[] }>>(
        appendAnonSessionId(`/api/chat/sessions/${sessionId}/messages`),
      );
      const msgs = res?.data?.messages ?? [];
      s.setChatHistory(() =>
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
      /* 메시지 조회 실패 — 빈 대화로 진행 */
    }
    router.push("/");
  };

  /** 새 대화: 서버가 세션을 만들고 Space 에 연결한다 → 빈 채팅으로 그 세션을 연다. */
  const startConversation = async (spaceId: string) => {
    const sessionId = await knowledgeApi.newConversation(spaceId);
    const s = useAppStore.getState();
    s.clearChat(); // history·contextRefs·아티팩트·currentSessionId 초기화
    s.setCurrentSessionId(sessionId); // clearChat 이 null 로 비운 뒤 새 세션 지정(순서 중요)
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    void queryClient.invalidateQueries({ queryKey: ["knowledge", "space", spaceId] });
    router.push("/");
  };

  return { openSession, startConversation };
}
