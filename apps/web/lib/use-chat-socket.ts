"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WsChatRequest, WsServerEvent } from "@openmake/shared-types";
import { useAppStore } from "./store";

/**
 * 채팅 WebSocket hook — 백엔드 sockets/ws-chat-handler.ts 프로토콜.
 *
 * 송신: {type:'chat', message, model, history, sessionId, images, webSearch, deepResearchMode, enabledTools}
 * 수신: {type:'token'|'done'|'error'|'aborted'|'session_created'|'init'|...}
 *
 * URL: dev 는 NEXT_PUBLIC_WS_URL(ws://localhost:52416, same-site 쿠키 전송),
 *      운영은 same-origin(location.host) → Nginx 업그레이드 프록시.
 */
function resolveWsUrl(): string {
  const env = process.env.NEXT_PUBLIC_WS_URL;
  if (env) return env;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  // Next dev 직접(:3000, Caddy 미경유)일 때만 백엔드 WS 포트(:52416)로 직접 연결.
  // 그 외(Caddy 경유 :33000 — 로컬 테스트/외부 공개)는 same-origin → Caddy 가 WS upgrade 를
  // 백엔드로 프록시한다. (Next.js rewrites 는 WS 를 프록시하지 못하므로 프록시 계층이 필수.)
  if (location.port === "3000") {
    return `${proto}//${location.hostname}:52416`;
  }
  return `${proto}//${location.host}`;
}

export function useChatSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectRef = useRef(0);

  const {
    appendMessage,
    appendToken,
    setStreaming,
    setCurrentSessionId,
    setActiveAgent,
    setActiveSkills,
  } = useAppStore();

  const connect = useCallback(() => {
    if (typeof window === "undefined") return;
    if (wsRef.current && wsRef.current.readyState <= 1) return;

    const ws = new WebSocket(resolveWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectRef.current = 0;
    };

    ws.onmessage = (ev) => {
      let data: WsServerEvent;
      try {
        data = JSON.parse(ev.data) as WsServerEvent;
      } catch {
        return;
      }
      switch (data.type) {
        case "token":
          if (data.token) appendToken(data.token);
          break;
        case "session_created":
          if (data.sessionId) setCurrentSessionId(data.sessionId);
          break;
        case "done":
          if (data.sessionId) setCurrentSessionId(data.sessionId);
          setStreaming(false);
          break;
        case "aborted":
          setStreaming(false);
          break;
        case "error":
          appendMessage({
            role: "system",
            content: `오류: ${data.message ?? "알 수 없는 오류"}`,
          });
          setStreaming(false);
          break;
        case "agent_selected":
          setActiveAgent({ name: data.agent.name, emoji: data.agent.emoji });
          break;
        case "skills_activated":
          setActiveSkills(data.skillNames);
          break;
        default:
          break; // init / research_progress / token_warning 등은 추후
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setStreaming(false);
      // 지수 백오프 재연결 (최대 10회)
      if (reconnectRef.current < 10) {
        const delay = Math.min(1000 * 2 ** reconnectRef.current, 10000);
        reconnectRef.current += 1;
        setTimeout(connect, delay);
      }
    };

    ws.onerror = () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    connect();
    return () => {
      reconnectRef.current = 99; // 언마운트 시 재연결 중단
      wsRef.current?.close();
    };
  }, [connect]);

  const sendChat = useCallback(
    (message: string, images?: string[]) => {
      const s = useAppStore.getState();
      if (!message.trim() || s.isGenerating) return;

      appendMessage({ role: "user", content: message, images });
      setActiveAgent(null); // 새 질문 — 이전 에이전트/스킬 표시 초기화
      setActiveSkills([]);
      setStreaming(true); // assistant placeholder 는 첫 token 에서 생성, isGenerating=true

      const payload: WsChatRequest = {
        type: "chat",
        message,
        model: s.selectedModel,
        history: s.chatHistory.map((m) => ({ role: m.role, content: m.content })),
        sessionId: s.currentSessionId,
        images: images ?? [],
        webSearch: s.webSearchEnabled,
        deepResearchMode: s.deepResearchMode,
        enabledTools: s.mcpToolsEnabled,
      };
      wsRef.current?.send(JSON.stringify(payload));
    },
    [appendMessage, setStreaming, setActiveAgent, setActiveSkills],
  );

  const abort = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "abort" }));
  }, []);

  return { connected, sendChat, abort };
}
