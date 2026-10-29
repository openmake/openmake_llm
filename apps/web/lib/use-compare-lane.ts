"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { WsChatRequest, WsServerEvent } from "@openmake/shared-types";
import { useAppStore } from "./store";
import { getAnonSessionId } from "./anon-session";
import { CLIENT_TIMING } from "./config";
import { resolveWsUrl } from "./use-chat-socket";
import { createWsLiveness } from "./ws-liveness";
import { uuid } from "./local-id";

/**
 * 모델 비교 모드 레인 훅 (2026-09-09).
 *
 * 메인 채팅(useChatSocket)과 달리 전역 store 의 chatHistory 를 쓰지 않는다 —
 * 레인마다 독립된 메시지 목록·세션·소켓을 소유해야 두 모델이 서로의 상태를 덮어쓰지 않는다.
 *
 * 소켓을 레인마다 따로 여는 이유: 백엔드 abort 컨트롤러가 "소켓 단위"라 한 소켓으로 두 스트림을
 * 돌리면 한쪽 abort 가 다른 쪽까지 끊는다. 스트림 레지스트리 충돌은 서버가 lane 접미사로
 * 분리하므로(ws-stream-registry.resolveStreamKey), 요청에 lane 을 함께 실어 보낸다.
 *
 * 중단·재연결(2026-10-29): 생성마다 클라이언트가 streamId(UUID)를 정해 chat 에 싣는다 — 첫 이벤트 전에 끊겨도
 * 그 생성을 지정해 이어받는다. 끊긴 동안 생성 중 표시(Stop)는 남고 전송은 막힌다. 재연결 소켓이 init 으로
 * exactResume 을 알리면 resume{exact} 를 보내고, 같은 streamId 의 stream_resume 을 받은 다음에만 남은 중단을 보낸다
 * (서버가 다른 탭의 생성을 붙이지 않으므로 그 생성을 끊지 않는다). 알리지 않는 서버(구 서버)에는 resume·abort 를
 * 보내지 않고 이어받지 못했다고 표시한다. 이 연결의 이벤트는 streamId 로 지금 생성의 것만 받는다(reset·새 요청 뒤
 * 늦게 온 지난 생성의 이벤트가 새 화면에 닿지 않게). reset 은 화면을 비우되 지난 생성의 중단은 끝까지 보낸다.
 * 살아 있는 소켓에서도 종료 응답이 WS_TERMINAL_WAIT_MS 안에 오지 않으면(다른 탭이 생성을 대체함·done 미재생) 정리한다.
 */
type CompareLaneId = "a" | "b";

/** 재연결 시도 한도 — 소진되면 UI 를 풀고, online·탭 복귀 때 다시 연다(메인 채팅과 같은 횟수). */
const MAX_RECONNECT_ATTEMPTS = 10;

/** 이 레인의 진행 중 생성 — 서버 결과(done·error·aborted·resume_none)를 받을 때까지 남는다. */
interface LaneGeneration {
  /** 이 생성의 streamId(클라이언트 발급) */
  id: string;
  /** reset 으로 화면에서 지웠다 — 결과는 그리지 않고 중단만 마무리한다 */
  hidden: boolean;
  /** 사용자가 중단을 눌렀다 — 서버 결과까지 유지하고 재연결 뒤 다시 보낸다 */
  abortWanted: boolean;
  /** live: 지금 소켓에 붙어 있음 · detached: 소켓을 잃음(다음 연결의 init 뒤 이어받기) · resuming: exact resume 응답 대기 */
  link: "live" | "detached" | "resuming";
  /** 마지막으로 받은 seq — exact resume 의 afterSeq */
  lastSeq: number;
  /** 서버가 이 생성을 등록했음을 안다(이 생성의 이벤트를 받음) — 등록 전에 닿은 abort 는 서버가 답 없이 버린다 */
  registered: boolean;
  /** 등록 확인 전에 abort 를 보냈다 — 첫 이벤트를 받으면 한 번 더 보낸다 */
  abortEarly: boolean;
  /** stream_resume 이 끝난 생성이라고 알렸다 — 재생되는 done 을 기다리되, 오지 않거나 소켓이 끊기면 스냅샷으로 끝낸다 */
  serverFinished: boolean;
}

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
  // 진행 중 생성(중단 의사·이어받기 상태 포함) — 렌더와 무관하게 소켓 콜백이 읽고 쓴다.
  const genRef = useRef<LaneGeneration | null>(null);
  // 첫 pong 전 무응답 재연결 예산 — 이 레인의 모든 소켓이 공유한다(다른 레인·메인 채팅과는 따로).
  const earlyRetryRef = useRef({ remaining: CLIENT_TIMING.WS_LIVENESS_EARLY_RETRY_LIMIT });
  // 현재 소켓의 생존 확인 조작 — Stop·네트워크·탭 복귀 때 바로 확인(probe)하거나 닫힌 소켓을 정리(drop)한다.
  const socketCtlRef = useRef<{ probe: () => void; drop: () => void } | null>(null);
  // 종료 응답 대기 — 살아 있는 소켓인데 서버가 답하지 않는 생성(다른 탭이 대체함·done 미재생)을 정리한다.
  const terminalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  /** 생성이 끝났다(서버 결과) — 화면에 보이던 생성이면 대기 상태를 푼다. */
  const finishGen = useCallback(() => {
    const gen = genRef.current;
    genRef.current = null;
    if (terminalTimerRef.current) {
      clearTimeout(terminalTimerRef.current);
      terminalTimerRef.current = null;
    }
    if (gen && !gen.hidden) setStreaming(false);
  }, [setStreaming]);

  /** 이어받을 수 없다 — 보이는 생성이면 안내를 남긴다(중단을 눌렀던 생성은 중단으로 끝낸다). */
  const loseGen = useCallback(() => {
    const gen = genRef.current;
    if (gen && !gen.hidden) {
      patchLastAssistant((m) =>
        gen.abortWanted
          ? { ...m, streaming: false }
          : { ...m, streaming: false, error: true, content: m.content || tCompareRef.current("resumeLost") },
      );
    }
    finishGen();
  }, [finishGen, patchLastAssistant]);

  /**
   * 종료 응답 대기 — 이 소켓에 붙은 채로 WS_TERMINAL_WAIT_MS 안에 종료 응답이 없으면 정리한다(UI 가 영구 정지하지 않게).
   * 서버가 끝났다고 알린 생성은 스냅샷으로 정상 종료하고, 중단을 보낸 생성은 잊기 전에 중단을 한 번 더 보낸 뒤 중단으로 끝낸다
   * (다른 탭의 새 요청이 이 생성을 대체하면 서버는 이 소켓의 abort 에 답하지 않는다). 그 사이 소켓이 바뀌었으면 재연결 경로에 맡긴다.
   */
  const armTerminalWait = useCallback(
    (gen: LaneGeneration) => {
      const ws = wsRef.current;
      if (terminalTimerRef.current) clearTimeout(terminalTimerRef.current);
      terminalTimerRef.current = setTimeout(() => {
        terminalTimerRef.current = null;
        if (genRef.current !== gen || gen.link !== "live" || wsRef.current !== ws) return;
        if (gen.serverFinished) {
          if (!gen.hidden) patchLastAssistant((m) => ({ ...m, streaming: false }));
          finishGen();
          return;
        }
        try {
          ws?.send(JSON.stringify({ type: "abort" })); // 늦게 등록된 생성이면 이번에 멈춘다
        } catch {
          /* 닫히는 소켓 */
        }
        loseGen();
      }, CLIENT_TIMING.WS_TERMINAL_WAIT_MS);
    },
    [finishGen, loseGen, patchLastAssistant],
  );

  /** 지금 소켓에 붙은 생성이면 중단을 보내고, 소켓이 살아 있는지 바로 확인한다(죽었으면 재연결 뒤 다시 보낸다). */
  const sendAbortIfLive = useCallback(
    (gen: LaneGeneration) => {
      const ws = wsRef.current;
      if (gen.link !== "live" || !ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify({ type: "abort" }));
      } catch {
        /* 닫히는 소켓 — 재연결 뒤 다시 보낸다 */
      }
      if (!gen.registered) gen.abortEarly = true;
      socketCtlRef.current?.probe();
      armTerminalWait(gen);
    },
    [armTerminalWait],
  );

  const connect = useCallback(() => {
    if (typeof window === "undefined") return;
    if (unmountedRef.current) return;
    if (wsRef.current && wsRef.current.readyState <= 1) return;

    const ws = new WebSocket(resolveWsUrl());
    wsRef.current = ws;
    // 이 연결의 서버가 정확 이어받기를 지원하는지 — init 으로 연결마다 배운다(이전 연결의 값을 쓰지 않는다).
    let exactResume = false;

    // 끊김 처리 — onclose 와 죽은 소켓 버리기가 함께 쓴다. 소켓마다 한 번만 돈다.
    let closedHandled = false;
    const handleClosed = () => {
      if (closedHandled) return;
      closedHandled = true;
      liveness.stop();
      setConnected(false);
      let gen = genRef.current;
      if (gen?.serverFinished) {
        // 서버가 끝났다고 알린 생성 — 서버는 끝난 스트림을 붙인 직후 버려 이어받을 수 없다(resume_none). 스냅샷으로 정상 종료한다.
        if (!gen.hidden) patchLastAssistant((m) => ({ ...m, streaming: false }));
        finishGen();
        gen = null;
      } else if (gen) {
        // 생성은 서버에서 계속된다(유예) — 생성 중 표시를 남기고 다음 연결에서 이어받는다.
        gen.link = "detached";
      }
      if (unmountedRef.current) return;
      if (reconnectRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(
          CLIENT_TIMING.WS_RECONNECT_BASE_MS * 2 ** reconnectRef.current,
          CLIENT_TIMING.WS_RECONNECT_MAX_MS,
        );
        reconnectRef.current += 1;
        reconnectTimerRef.current = setTimeout(() => connectRef.current(), delay);
        return;
      }
      // 한도 소진 — Stop·입력이 멈춰 있지 않게 UI 를 푼다. 중단을 눌렀던 생성은 숨겨 두고
      // online·탭 복귀로 다시 연결되면 마저 중단한다.
      if (gen?.abortWanted) {
        if (!gen.hidden) {
          patchLastAssistant((m) => ({ ...m, streaming: false }));
          setStreaming(false);
        }
        gen.hidden = true;
      } else if (gen) {
        loseGen();
      }
    };
    // 죽은(half-open) 소켓 버리기 — 핸들러를 떼고 늦게 올 onclose 를 기다리지 않고 끊김 처리를 지금 한다.
    const dropSocket = () => {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      handleClosed();
    };
    // 생존 확인(ws-liveness, 메인 채팅과 같은 규칙) — 응답이 없는 half-open 소켓은 버리고 재연결한다.
    const liveness = createWsLiveness({
      intervalMs: CLIENT_TIMING.WS_LIVENESS_INTERVAL_MS,
      timeoutMs: CLIENT_TIMING.WS_LIVENESS_TIMEOUT_MS,
      sendPing: () => ws.send(JSON.stringify({ type: "ping", t: Date.now() })),
      onDead: dropSocket,
      earlyRetry: earlyRetryRef.current,
    });
    socketCtlRef.current = { probe: () => liveness.probe(), drop: dropSocket };

    /** init — 끊긴 생성이 있으면 이 연결이 정확 이어받기를 지원할 때만 resume 을 보낸다. */
    const onInit = () => {
      const gen = genRef.current;
      if (!gen || gen.link !== "detached") return;
      if (!exactResume) {
        // 구 서버 — 커서가 달라도 붙이므로 다른 탭의 생성을 빼앗을 수 있다. 이어받지 않고 정리한다.
        loseGen();
        return;
      }
      gen.link = "resuming";
      ws.send(
        JSON.stringify({
          type: "resume",
          anonSessionId: getAnonSessionId(),
          lane: laneRef.current,
          streamId: gen.id,
          afterSeq: gen.lastSeq,
          exact: true,
        }),
      );
    };

    ws.onopen = () => {
      // 언마운트 후 뒤늦게 열린 소켓이면 즉시 닫아 좀비를 방지.
      if (unmountedRef.current) {
        ws.close();
        return;
      }
      setConnected(true);
      reconnectRef.current = 0;
      liveness.start();
    };

    ws.onmessage = (ev) => {
      liveness.noteInbound(); // 무엇이든 받았으면 살아 있다
      let data: WsServerEvent;
      try {
        data = JSON.parse(ev.data) as WsServerEvent;
      } catch {
        return;
      }
      if (data.type === "pong") {
        liveness.notePong(); // 생존 확인 응답 — 서버가 앱 ping 을 지원한다
        return;
      }
      if (data.type === "init") {
        exactResume = data.capabilities?.exactResume === true;
        onInit();
        return;
      }
      const gen = genRef.current;
      // 이 연결이 정확 이어받기를 지원하면 이벤트는 streamId 로 지금 생성의 것만 받는다. 구 서버는 종전대로 다 받는다.
      const envelope = data as { streamId?: unknown; seq?: unknown };
      if (exactResume && typeof envelope.streamId === "string") {
        if (!gen || envelope.streamId !== gen.id) return; // 지난 생성·다른 탭의 생성
        if (typeof envelope.seq === "number") {
          if (envelope.seq <= gen.lastSeq) return; // 재생 중복
          gen.lastSeq = envelope.seq;
        }
        if (!gen.registered) {
          gen.registered = true;
          // 서버 등록 전에 닿은 중단은 답 없이 버려졌을 수 있다 — 등록을 확인했으니 한 번 더 보낸다(끝난 생성이면 불필요).
          if (gen.abortEarly && data.type !== "done" && data.type !== "error" && data.type !== "aborted") sendAbortIfLive(gen);
          gen.abortEarly = false;
        }
      }
      const visible = exactResume ? !!gen && !gen.hidden : true;
      switch (data.type) {
        case "token":
          if (visible && data.token) {
            const tok = data.token;
            patchLastAssistant((m) => ({ ...m, content: m.content + tok }));
          }
          break;
        case "thinking":
          if (visible && data.token) {
            const tok = data.token;
            patchLastAssistant((m) => ({ ...m, thinking: (m.thinking ?? "") + tok }));
          }
          break;
        case "session_created":
          if (visible && data.sessionId) {
            sessionIdRef.current = data.sessionId;
            setSessionId(data.sessionId);
          }
          break;
        case "stream_resume": {
          // 정확 이어받기 성공 — 끊긴 사이 서버가 계속 만든 답변 스냅샷으로 본문을 되돌린다.
          if (!gen || gen.link !== "resuming") break;
          gen.link = "live";
          if (!gen.hidden) {
            if (data.sessionId) {
              sessionIdRef.current = data.sessionId;
              setSessionId(data.sessionId);
            }
            const { content, thinking } = data;
            patchLastAssistant((m) => ({ ...m, content, ...(thinking ? { thinking } : {}), streaming: true, error: false }));
          }
          // 같은 스트림이 이 소켓에 붙었다 — 이제 남은 중단을 보낸다. 끝난 스트림이면 뒤이어 재생되는 done 이 끝내고,
          // 재생되지 않으면(이미 전달됐다고 기록된 done·링 비활성) 대기 뒤 스냅샷으로 끝낸다.
          if (data.finished) {
            gen.serverFinished = true;
            armTerminalWait(gen);
          } else if (gen.abortWanted) sendAbortIfLive(gen);
          break;
        }
        case "resume_none":
          // 이어받을 스트림 없음(유예 만료·다른 생성으로 바뀜) — 대기를 풀고 안내를 남긴다.
          if (gen && gen.link === "resuming") loseGen();
          break;
        case "system_event":
          // 모델 폴백 고지 — 선택 모델이 실패해 다른 모델이 답했음을 헤더 배지로 노출.
          if (visible && data.payload?.type === "model_fallback") {
            const md = (data.payload.metadata ?? {}) as { to?: string };
            const to = String(md.to ?? "");
            if (to) patchLastAssistant((m) => ({ ...m, model: to }));
          }
          break;
        case "done": {
          if (visible) {
            const metrics = data.metrics;
            const cleaned = data.cleanedContent;
            patchLastAssistant((m) => ({
              ...m,
              streaming: false,
              ...(typeof cleaned === "string" ? { content: cleaned } : {}),
              ...(metrics ? { metrics } : {}),
            }));
          }
          finishGen();
          break;
        }
        case "aborted":
          // 중단을 보낸 생성의 응답만 받는다 — 보내지 않은 생성(새 요청)을 끝내지 않는다.
          if (!gen?.abortWanted) break;
          if (visible) patchLastAssistant((m) => ({ ...m, streaming: false }));
          finishGen();
          break;
        case "error": {
          if (visible) {
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
          }
          finishGen();
          break;
        }
        default:
          // build_id / artifact_* / research_progress / agent_task_* 등 비교 모드에서
          // 쓰지 않는 이벤트는 조용히 무시한다.
          break;
      }
    };

    ws.onclose = handleClosed;

    ws.onerror = () => ws.close();
  }, [armTerminalWait, finishGen, loseGen, patchLastAssistant, sendAbortIfLive, setStreaming]);

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
      if (terminalTimerRef.current) {
        clearTimeout(terminalTimerRef.current);
        terminalTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  // 네트워크·탭 복귀 — 소켓이 열려 있으면 살아 있는지 바로 확인하고, 닫혔으면(재연결 한도 소진 포함)
  // 백오프 대기를 버리고 바로 다시 연다.
  useEffect(() => {
    const recover = () => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        socketCtlRef.current?.probe();
        return;
      }
      if (ws?.readyState === WebSocket.CONNECTING) return;
      socketCtlRef.current?.drop(); // 닫히는 중이면 끊김 처리를 지금 끝낸다(이미 끝났으면 무동작)
      reconnectRef.current = 0;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      connectRef.current();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") recover();
    };
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

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

      // 새 생성 — 숨겨 둔 지난 생성(reset·한도 소진)이 있었으면 서버가 같은 레인 키의 새 요청으로 대체(중단)한다.
      const id = uuid();
      genRef.current = { id, hidden: false, abortWanted: false, link: "live", lastSeq: 0, registered: false, abortEarly: false, serverFinished: false };

      const payload: WsChatRequest = {
        type: "chat",
        message,
        model,
        lane: laneRef.current,
        streamId: id,
        history,
        sessionId: sessionIdRef.current,
        anonSessionId: getAnonSessionId(),
        images: [],
        files: [],
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

  // 중단 — 그 레인의 지금 생성에만. 끊겨 있으면 기억했다가 재연결 뒤 이어받기가 끝나면 보낸다.
  const abort = useCallback(() => {
    const gen = genRef.current;
    if (!gen || gen.hidden) return;
    gen.abortWanted = true;
    sendAbortIfLive(gen);
  }, [sendAbortIfLive]);

  // 화면 비우기 — 진행 중 생성은 숨겨 결과를 그리지 않고, 중단은 서버 결과까지 끝까지 보낸다.
  const reset = useCallback(() => {
    const gen = genRef.current;
    if (gen && !gen.hidden) {
      gen.hidden = true;
      if (!gen.abortWanted) {
        gen.abortWanted = true;
        sendAbortIfLive(gen);
      }
    }
    streamingRef.current = false;
    setStreamingState(false);
    sessionIdRef.current = null;
    setSessionId(null);
    messagesRef.current = [];
    setMessages([]);
  }, [sendAbortIfLive]);

  return { messages, sessionId, connected, streaming, send, abort, reset };
}
