"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { WsChatRequest, WsServerEvent } from "@openmake/shared-types";
import { useAppStore } from "./store";
import { getAnonSessionId } from "./anon-session";
import { CLIENT_TIMING } from "./config";
import { resolveWsUrl } from "./use-chat-socket";

/**
 * 모델 비교 모드 레인 훅 (2026-09-09).
 *
 * 메인 채팅(useChatSocket)과 달리 전역 store 의 chatHistory 를 쓰지 않는다 —
 * 레인마다 독립된 메시지 목록·세션·소켓을 소유해야 두 모델이 서로의 상태를 덮어쓰지 않는다.
 *
 * 소켓을 레인마다 따로 여는 이유: 백엔드 abort 컨트롤러가 "소켓 단위"라 한 소켓으로 두 스트림을
 * 돌리면 한쪽 abort 가 다른 쪽까지 끊는다. 스트림 레지스트리 충돌은 서버가 lane 접미사로
 * 분리하므로(ws-stream-registry.resolveStreamKey), 요청에 lane 을 함께 실어 보낸다.
 */
export type CompareLaneId = "a" | "b";

export interface CompareMessage {
  role: "user" | "assistant";
  content: string;
  /** 추론(thinking) 누적 — 접이식 블록으로 표시 */
  thinking?: string;
  /** 폴백으로 실제 답변한 모델 (선택 모델과 다를 때만 채워진다) */
  model?: string;
  streaming?: boolean;
  /** 오류/안내로 종료된 답변 — 빨간 텍스트로 표시 */
  error?: boolean;
  metrics?: { tokensPerSec: string; tokenCount: number };
}

/** 전송 옵션 — 모델 외 변수는 기본 고정이고, 여기 있는 것만 사용자가 켤 수 있다. */
export interface CompareSendOptions {
  /** Thinking(추론) — 켜면 store 의 thinkingLevel 을 함께 실어 메인 채팅과 같은 강도로 돈다. */
  thinking?: boolean;
}

export interface CompareLane {
  messages: CompareMessage[];
  sessionId: string | null;
  connected: boolean;
  streaming: boolean;
  send: (prompt: string, model: string, opts?: CompareSendOptions) => void;
  abort: () => void;
  reset: () => void;
}

export function useCompareLane(lane: CompareLaneId): CompareLane {
  const t = useTranslations("chatSocket");
  const tCompare = useTranslations("compare");

  const [messages, setMessages] = useState<CompareMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [streaming, setStreamingState] = useState(false);

  // 콜백이 stale 클로저에 t 를 가두지 않도록 ref 경유(렌더 중 쓰기 금지 → effect 에서 갱신).
  const tRef = useRef(t);
  const tCompareRef = useRef(tCompare);
  useEffect(() => {
    tRef.current = t;
    tCompareRef.current = tCompare;
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const connectRef = useRef<() => void>(() => {});
  // onclose/send 가 최신 값을 읽어야 하는 상태들 — 렌더 사이클과 무관하게 ref 로 보관.
  const streamingRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const messagesRef = useRef<CompareMessage[]>([]);
  // 스트리밍 도중 끊겼음 — 재연결 직후 resume 으로 서버가 계속 만든 답변을 이어받는다.
  const pendingResumeRef = useRef(false);
  const laneRef = useRef<CompareLaneId>(lane);

  useEffect(() => {
    laneRef.current = lane;
  }, [lane]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const setStreaming = useCallback((v: boolean) => {
    streamingRef.current = v;
    setStreamingState(v);
  }, []);

  /** 마지막 assistant 메시지를 부분 갱신 (없으면 무시). */
  const patchLastAssistant = useCallback(
    (patch: (m: CompareMessage) => CompareMessage) => {
      setMessages((prev) => {
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].role === "assistant") {
            const next = prev.slice();
            next[i] = patch(prev[i]);
            return next;
          }
        }
        return prev;
      });
    },
    [],
  );

  const connect = useCallback(() => {
    if (typeof window === "undefined") return;
    if (unmountedRef.current) return;
    if (wsRef.current && wsRef.current.readyState <= 1) return;

    const ws = new WebSocket(resolveWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      // 언마운트 후 뒤늦게 열린 소켓이면 즉시 닫아 좀비를 방지.
      if (unmountedRef.current) {
        ws.close();
        return;
      }
      setConnected(true);
      reconnectRef.current = 0;
      if (pendingResumeRef.current) {
        pendingResumeRef.current = false;
        ws.send(
          JSON.stringify({
            type: "resume",
            anonSessionId: getAnonSessionId(),
            lane: laneRef.current,
          }),
        );
      }
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
          if (data.token) {
            const tok = data.token;
            patchLastAssistant((m) => ({ ...m, content: m.content + tok }));
          }
          break;
        case "thinking":
          if (data.token) {
            const tok = data.token;
            patchLastAssistant((m) => ({ ...m, thinking: (m.thinking ?? "") + tok }));
          }
          break;
        case "session_created":
          if (data.sessionId) {
            sessionIdRef.current = data.sessionId;
            setSessionId(data.sessionId);
          }
          break;
        case "stream_resume": {
          // 끊긴 사이 서버가 계속 만든 답변 스냅샷 — 본문을 통째로 되돌리고 다시 스트리밍 상태로.
          if (data.sessionId) {
            sessionIdRef.current = data.sessionId;
            setSessionId(data.sessionId);
          }
          const { content, thinking, finished } = data;
          patchLastAssistant((m) => ({
            ...m,
            content,
            ...(thinking ? { thinking } : {}),
            streaming: true,
            error: false,
          }));
          if (!finished) setStreaming(true);
          break;
        }
        case "resume_none":
          // 이어받을 스트림 없음 — 대기 상태를 풀고 안내를 남긴다.
          patchLastAssistant((m) =>
            m.streaming
              ? {
                  ...m,
                  streaming: false,
                  error: true,
                  content: m.content || tCompareRef.current("resumeLost"),
                }
              : m,
          );
          setStreaming(false);
          break;
        case "system_event":
          // 모델 폴백 고지 — 선택 모델이 실패해 다른 모델이 답했음을 헤더 배지로 노출.
          if (data.payload?.type === "model_fallback") {
            const md = (data.payload.metadata ?? {}) as { to?: string };
            const to = String(md.to ?? "");
            if (to) patchLastAssistant((m) => ({ ...m, model: to }));
          }
          break;
        case "done": {
          const metrics = data.metrics;
          const cleaned = data.cleanedContent;
          patchLastAssistant((m) => ({
            ...m,
            streaming: false,
            ...(typeof cleaned === "string" ? { content: cleaned } : {}),
            ...(metrics ? { metrics } : {}),
          }));
          setStreaming(false);
          break;
        }
        case "aborted":
          patchLastAssistant((m) => ({ ...m, streaming: false }));
          setStreaming(false);
          break;
        case "error": {
          let errMsg = data.message ?? tRef.current("unknownError");
          if (typeof data.retryAfter === "number" && data.retryAfter > 0) {
            const sec = Math.ceil(data.retryAfter);
            errMsg += ` (약 ${sec}초 후 재시도 가능 / retry in ~${sec}s)`;
          }
          const text = tRef.current("error", { message: errMsg });
          patchLastAssistant((m) => ({
            ...m,
            streaming: false,
            error: true,
            content: m.content ? `${m.content}\n\n${text}` : text,
          }));
          setStreaming(false);
          break;
        }
        default:
          // init / build_id / artifact_* / research_progress / agent_task_* 등 비교 모드에서
          // 쓰지 않는 이벤트는 조용히 무시한다.
          break;
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (streamingRef.current) pendingResumeRef.current = true;
      setStreaming(false);
      if (unmountedRef.current) return;
      if (reconnectRef.current < 10) {
        const delay = Math.min(
          CLIENT_TIMING.WS_RECONNECT_BASE_MS * 2 ** reconnectRef.current,
          CLIENT_TIMING.WS_RECONNECT_MAX_MS,
        );
        reconnectRef.current += 1;
        reconnectTimerRef.current = setTimeout(() => connectRef.current(), delay);
      }
    };

    ws.onerror = () => ws.close();
  }, [patchLastAssistant, setStreaming]);

  useEffect(() => {
    unmountedRef.current = false; // StrictMode 재마운트 대비 리셋
    connectRef.current = connect;
    connect();
    return () => {
      unmountedRef.current = true; // 언마운트 시 재연결 중단
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const send = useCallback(
    (prompt: string, model: string, opts?: CompareSendOptions) => {
      const message = prompt.trim();
      if (!message || streamingRef.current) return;

      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        // OPEN 이 아니면 send 가 조용히 버려지거나 throw 해 done 이 영영 안 온다 —
        // 상태를 더럽히기 전에 차단하고 재연결을 유도한다.
        setMessages((prev) => [
          ...prev,
          { role: "user", content: message },
          { role: "assistant", content: tRef.current("disconnected"), error: true },
        ]);
        connectRef.current();
        return;
      }

      const s = useAppStore.getState();
      // history 는 "이번 사용자 메시지 직전까지" — 메인 훅과 동일하게 안내/오류는 제외한다.
      // 본문이 빈 assistant(첫 토큰 전 중단)도 제외 — 외부 provider 가 빈 assistant 로 400 을 낸다.
      const history = messagesRef.current
        .filter((m) => !m.error && !(m.role === "assistant" && m.content.trim().length === 0))
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [
        ...prev,
        { role: "user", content: message },
        { role: "assistant", content: "", streaming: true },
      ]);
      setStreaming(true);

      const payload: WsChatRequest = {
        type: "chat",
        message,
        model,
        lane: laneRef.current,
        history,
        sessionId: sessionIdRef.current,
        anonSessionId: getAnonSessionId(),
        images: [],
        files: [],
        deepResearchMode: false,
        discussionMode: false,
        thinkingMode: opts?.thinking === true,
        // 추론 강도 — 토글이 켜진 경우에만 의미(서버가 thinkingMode=false 면 무시). 메인 훅과 동일.
        ...(opts?.thinking ? { thinkingLevel: s.thinkingLevel } : {}),
        style: s.style,
        enabledTools: s.mcpToolsEnabled,
        // 비교 모드는 서버에 남기지 않는다 — 레인마다 세션이 하나씩 생겨 사이드바에 "반쪽 대화"가
        // 두 개씩 쌓이고, 두 모델의 상반된 답이 장기 메모리에 함께 학습되는 것을 막는다.
        // 멀티턴 맥락은 레인별 history 로 클라이언트가 직접 실어 보내므로 세션 없이도 이어진다.
        saveHistory: false,
        memoryLearning: false,
      };
      ws.send(JSON.stringify(payload));
    },
    [setStreaming],
  );

  const abort = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "abort" }));
  }, []);

  const reset = useCallback(() => {
    if (streamingRef.current) abort();
    pendingResumeRef.current = false;
    streamingRef.current = false;
    setStreamingState(false);
    sessionIdRef.current = null;
    setSessionId(null);
    messagesRef.current = [];
    setMessages([]);
  }, [abort]);

  return { messages, sessionId, connected, streaming, send, abort, reset };
}
