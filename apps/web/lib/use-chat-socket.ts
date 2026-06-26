"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WsChatRequest, WsServerEvent, WsAttachedFile } from "@openmake/shared-types";
import { useAppStore, type StructuredAnswerData, type PendingApproval, type AgentTaskState } from "./store";
import { ApiClient } from "./api-client";
import { CLIENT_TIMING } from "./config";

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

/**
 * 게스트(비로그인) REST 호출용 anon 세션 ID. localStorage 에 영속.
 * 백엔드 resolveUserContextFromRequest 는 req.user 없고 anonSessionId 도 없으면 401 →
 * ApiClient 401 핸들러가 로그인 리다이렉트를 트리거하므로, 게스트도 식별자를 보내 게스트 컨텍스트를 받게 한다.
 */
function getAnonSessionId(): string {
  try {
    const KEY = "omk_anon_session";
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() ?? `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `anon-${Date.now()}`;
  }
}

export function useChatSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectRef = useRef(0);
  // 에이전트 작업 taskId → 목표(goal) — agent_task_progress 렌더에 사용
  // 구조화 답변(REST) 진행 중 AbortController — abort() 가 취소할 수 있게 보관
  const structuredAbortRef = useRef<AbortController | null>(null);

  const {
    appendMessage,
    setChatHistory,
    appendToken,
    appendThinking,
    setStreaming,
    setCurrentSessionId,
    setActiveAgent,
    setActiveSkills,
    setResearchProgress,
    startArtifact,
    appendArtifactDelta,
    endArtifact,
    registerArtifacts,
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
        case "thinking":
          if (data.token) appendThinking(data.token);
          break;
        case "session_created":
          if (data.sessionId) setCurrentSessionId(data.sessionId);
          break;
        case "done":
          if (data.sessionId) setCurrentSessionId(data.sessionId);
          setStreaming(false);
          setResearchProgress(null);
          break;
        case "aborted":
          setStreaming(false);
          setResearchProgress(null);
          break;
        case "error":
          appendMessage({
            role: "system",
            content: `오류: ${data.message ?? "알 수 없는 오류"}`,
          });
          setStreaming(false);
          setResearchProgress(null);
          break;
        case "research_progress": {
          // 딥리서치 진행을 채팅 상태 배너로 라이브 표시(스트리밍 시작 전/중).
          const p = data.progress ?? {};
          setResearchProgress({
            currentStep: p.currentStep ?? "",
            progress: Math.max(0, Math.min(100, Math.round(p.progress ?? 0))),
            message: p.message ?? "",
            currentLoop: p.currentLoop ?? 0,
            totalLoops: p.totalLoops ?? 0,
          });
          break;
        }
        case "agent_selected":
          setActiveAgent({ name: data.agent.name, emoji: data.agent.emoji });
          break;
        case "skills_activated":
          setActiveSkills(data.skillNames);
          break;
        case "artifact_start":
          startArtifact(data.artifact);
          break;
        case "artifact_chunk":
          appendArtifactDelta(data.id, data.delta);
          break;
        case "artifact_end":
          endArtifact(data.id);
          break;
        case "agent_task_progress": {
          // 에이전트 작업 진행을 구조화 상태(agentTask)로 갱신 → AgentTaskCard 가 벡터 아이콘으로 렌더.
          const { taskId, status, progress, currentTurn } = data;
          const terminal =
            status === "completed" || status === "failed" || status === "cancelled";
          const merge = (extra: Partial<AgentTaskState>, approvals: PendingApproval[] | undefined) =>
            setChatHistory((prev) =>
              prev.map((m) =>
                m.taskId === taskId
                  ? {
                      ...m,
                      approvals,
                      agentTask: {
                        goal: m.agentTask?.goal ?? "",
                        ...(m.agentTask ?? {}),
                        status, currentTurn, progress,
                        ...extra,
                      } as AgentTaskState,
                    }
                  : m,
              ),
            );

          if (terminal) {
            void (async () => {
              let result = "";
              const artifactIds: string[] = [];
              let files: string[] = [];
              try {
                const r = await ApiClient.get<{
                  data: { task: { result?: string }; steps?: Array<{ step_type: string; content?: string }> };
                }>(`/api/agent-tasks/${taskId}`);
                result = r?.data?.task?.result ?? "";
                // deliverable 아티팩트 — store 등록 후 카드가 칩으로 렌더.
                const arts = (r?.data?.steps ?? [])
                  .filter((s) => s.step_type === "artifact")
                  .map((s) => { try { return JSON.parse(s.content ?? ""); } catch { return null; } })
                  .filter((a): a is { id: string; kind: string; title?: string; lang?: string | null; content?: string } => !!a?.id);
                if (arts.length > 0) {
                  registerArtifacts(arts.map((a) => ({
                    id: a.id, kind: a.kind, title: a.title ?? a.id, lang: a.lang ?? null, content: a.content ?? "", streaming: false,
                  })));
                  for (const a of arts) artifactIds.push(a.id);
                }
              } catch { /* 결과 조회 실패 — 상태만 */ }
              try {
                const f = await ApiClient.get<{ data: { files: string[] } }>(`/api/agent-tasks/${taskId}/files`);
                files = f?.data?.files ?? [];
              } catch { /* 파일 없음 */ }
              merge({ result, artifactIds, files }, undefined);
            })();
          } else if (status === "paused") {
            // 승인 대기 — 해당 task 의 pending approval 조회 → 카드에 인라인 승인 버튼.
            void (async () => {
              let mine: PendingApproval[] = [];
              try {
                const r = await ApiClient.get<{ data: { pending: PendingApproval[] } }>(`/api/agent-tasks/approvals/pending`);
                mine = (r?.data?.pending ?? []).filter((p) => p.taskId === taskId);
              } catch { /* 조회 실패 — 상태만 */ }
              merge({}, mine);
            })();
          } else {
            merge({}, undefined);
          }
          break;
        }
        default:
          break; // init / token_warning 등은 추후
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setStreaming(false);
      // 지수 백오프 재연결 (최대 10회)
      if (reconnectRef.current < 10) {
        const delay = Math.min(
          CLIENT_TIMING.WS_RECONNECT_BASE_MS * 2 ** reconnectRef.current,
          CLIENT_TIMING.WS_RECONNECT_MAX_MS,
        );
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
    (message: string, images?: string[], files?: WsAttachedFile[]) => {
      const s = useAppStore.getState();
      const hasFiles = Array.isArray(files) && files.length > 0;
      // 텍스트가 비어도 첨부 파일만으로 전송 가능
      if ((!message.trim() && !hasFiles) || s.isGenerating) return;

      // 첨부만 있고 본문이 비면 파일명을 표시용 본문으로 사용
      const displayContent =
        message.trim() || (hasFiles ? files!.map((f) => f.name).join(", ") : "");
      appendMessage({ role: "user", content: displayContent, images });
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
        files: files ?? [],
        webSearch: s.webSearchEnabled,
        deepResearchMode: s.deepResearchMode,
        discussionMode: s.discussionMode,
        thinkingMode: s.thinkingEnabled,
        imageMode: s.imageMode,
        artifactMode: s.artifactMode,
        style: s.style,
        enabledTools: s.mcpToolsEnabled,
      };
      wsRef.current?.send(JSON.stringify(payload));
    },
    [appendMessage, setStreaming, setActiveAgent, setActiveSkills],
  );

  const abort = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "abort" }));
    // 구조화 답변(REST) 진행 중이면 fetch 도 취소
    structuredAbortRef.current?.abort();
  }, []);

  // 에이전트 토글 ON: 메시지를 목표(goal)로 자율 에이전트 작업을 생성·실행한다.
  // (채팅 WS 가 아니라 REST POST /api/agent-tasks + /execute — 진행상황은 '에이전트 작업' 페이지)
  const startAgentTask = useCallback(
    async (message: string) => {
      const goal = message.trim();
      const s = useAppStore.getState();
      if (!goal || s.isGenerating) return;
      appendMessage({ role: "user", content: goal });
      try {
        const created = await ApiClient.post<{ data: { task: { id: string } } }>(
          "/api/agent-tasks",
          { goal },
        );
        const taskId = created?.data?.task?.id;
        if (!taskId) throw new Error("작업 생성 응답에 taskId 가 없습니다");
        // 진행상황 카드 — agent_task_progress 이벤트로 taskId 로 식별해 라이브 업데이트.
        appendMessage({
          role: "assistant",
          taskId,
          content: "",
          agentTask: { goal, status: "pending", currentTurn: 0, progress: 0 },
        });
        await ApiClient.post(`/api/agent-tasks/${taskId}/execute`);
      } catch (e) {
        appendMessage({
          role: "assistant",
          content: `에이전트 작업을 시작하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    },
    [appendMessage],
  );

  // 구조화 답변 모드 — WebSocket 스트리밍 대신 REST /api/chat/structured 호출(비스트리밍).
  // 백엔드가 Answer Planner → JSON Schema → Validator → formatAnswer 파이프라인으로
  // { intent, structured, markdown } 을 반환. structured 는 카드 UI(StructuredAnswer)로 렌더.
  const sendStructured = useCallback(
    async (message: string) => {
      const msg = message.trim();
      const s = useAppStore.getState();
      if (!msg || s.isGenerating) return;
      appendMessage({ role: "user", content: msg });
      setStreaming(true);
      const controller = new AbortController();
      structuredAbortRef.current = controller;
      try {
        const res = await ApiClient.post<{
          data: { intent: string; structured: StructuredAnswerData; markdown: string };
        }>(
          "/api/chat/structured",
          {
            message: msg,
            model: s.selectedModel,
            anonSessionId: getAnonSessionId(),
            // 웹 기능 토글을 구조화 모드에도 전달 — 백엔드가 시사 질의 시 웹검색 수행.
            webSearch: s.webSearchEnabled,
            enabledTools: s.mcpToolsEnabled,
            // userLanguage 는 보내지 않는다 — 백엔드가 메시지 내용으로 언어를 감지(WS 채팅과 동일).
            // navigator.language(브라우저 로케일)에 의존하면 en-* 브라우저의 한국어 사용자가
            // 한국어 질문에도 영어 답변을 받는 회귀가 발생했다.
          },
          { signal: controller.signal },
        );
        const data = res?.data;
        appendMessage({
          role: "assistant",
          content: data?.markdown ?? "",
          structured: data?.structured,
        });
      } catch (e) {
        const aborted = e instanceof DOMException && e.name === "AbortError";
        appendMessage({
          role: "assistant",
          content: aborted
            ? "_(구조화 답변 생성을 중단했습니다.)_"
            : `구조화 답변을 생성하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`,
        });
      } finally {
        structuredAbortRef.current = null;
        setStreaming(false);
      }
    },
    [appendMessage, setStreaming],
  );

  return { connected, sendChat, abort, startAgentTask, sendStructured };
}
