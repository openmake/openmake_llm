"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { WsChatRequest, WsServerEvent, WsAttachedFile } from "@openmake/shared-types";
import { useAppStore, type StructuredAnswerData, type PendingApproval, type AgentTaskState } from "./store";
import { ApiClient, csrfHeaders } from "./api-client";

import { getAnonSessionId } from "./anon-session";
import { CLIENT_TIMING } from "./config";
import { encodeMcpResources, type McpResourcePayload } from "@/components/chat/mcp-resource-card";

// 배포 감지·토큰 갱신 상태는 소켓 재연결/훅 재마운트 간에도 유지되어야 하므로 모듈 레벨에 둔다.
let moduleKnownBuildId: string | null = null;
let moduleTokenRefreshing = false;
let moduleReloadPending = false;

/** 첨부 파일 UI 상태 — WS 계약(WsAttachedFile)에 브라우저 File 원본을 얹은 로컬 확장.
 *  rawFile 이 있으면 에이전트 작업 생성 시 multipart 로 원본을 스트리밍 업로드한다
 *  (base64-in-JSON 의 메모리/크기 한계 회피). WS 채팅 전송 시에는 제거된다. */
export type AttachedFileUI = WsAttachedFile & { rawFile?: File };

/** WS/REST 직렬화용 — 브라우저 File(rawFile)을 계약 필드에서 제거한다. */
function toWireFile(f: AttachedFileUI): WsAttachedFile {
  const { rawFile, ...rest } = f;
  void rawFile;
  return rest;
}

/** 청크 업로드 임계값 — chat.openmake.cc 는 Cloudflare 무료 플랜이라 요청당 100MB 상한.
 *  바이너리 합계가 이를 넘보면 단일 multipart 대신 청크 경로로 전환한다(여유 마진 포함). */
const CHUNKED_UPLOAD_THRESHOLD_BYTES = 60 * 1024 * 1024;
/** 청크 크기 — Cloudflare 상한(100MB) 대비 충분히 작게. 서버 상한(기본 32MB) 이하여야 한다. */
const CHUNK_SIZE_BYTES = 24 * 1024 * 1024;

/** 파일 하나를 청크로 나눠 업로드(init → PUT×N → complete)하고 uploadId 를 반환.
 *  각 요청이 CHUNK_SIZE 이하라 Cloudflare 100MB 상한에 걸리지 않는다. */
async function uploadFileInChunks(file: File): Promise<string> {
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE_BYTES));
  const init = await ApiClient.post<{ data: { uploadId: string } }>(
    "/api/agent-task-uploads",
    { name: file.name, type: file.type || undefined, size: file.size, totalChunks },
  );
  const uploadId = init?.data?.uploadId;
  if (!uploadId) throw new Error("업로드 세션 생성 실패");
  for (let i = 0; i < totalChunks; i++) {
    const blob = file.slice(i * CHUNK_SIZE_BYTES, Math.min((i + 1) * CHUNK_SIZE_BYTES, file.size));
    const resp = await fetch(`/api/agent-task-uploads/${uploadId}/chunks/${i}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/octet-stream", ...(await csrfHeaders()) },
      body: blob,
    });
    if (!resp.ok) throw new Error(`청크 ${i + 1}/${totalChunks} 업로드 실패 (HTTP ${resp.status})`);
  }
  const done = await fetch(`/api/agent-task-uploads/${uploadId}/complete`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(await csrfHeaders()) },
    body: "{}",
  });
  if (!done.ok) throw new Error(`업로드 완료 처리 실패 (HTTP ${done.status})`);
  return uploadId;
}

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
  const t = useTranslations("chatSocket");
  // 콜백들이 stale deps(useCallback([]) 등)로 메모이즈되어 t 가 클로저에 갇히므로
  // ref 로 최신 t 를 참조한다(렌더 중 ref 쓰기 금지 규칙이라 effect 에서 갱신).
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectRef = useRef(0);
  // 언마운트 후 발화하는 재연결 타이머를 취소하기 위한 핸들 + 언마운트 플래그.
  // (onclose 가 예약한 setTimeout(connect) 가 언마운트 뒤 좀비 소켓을 여는 것을 차단)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  // connect 자기참조(재연결 예약)용 — useCallback 선언 내부에서 자신을 직접 참조하지 않도록 ref 경유
  const connectRef = useRef<() => void>(() => {});
  // 에이전트 작업 taskId → 목표(goal) — agent_task_progress 렌더에 사용
  // 구조화 답변(REST) 진행 중 AbortController — abort() 가 취소할 수 있게 보관
  const structuredAbortRef = useRef<AbortController | null>(null);
  // token_warning 갱신이 스트리밍 중 도착하면 스트림 종료 후 재연결하기 위한 예약 플래그.
  const reconnectAfterRefreshRef = useRef(false);
  // MCP 도구 결과 resource — 스트리밍 중 append 하면 응답이 조각나므로(appendToken 이 카드를
  // 마지막 메시지로 오인) 버퍼에 모았다가 스트림 종료 시 flush 한다.
  const pendingMcpResourcesRef = useRef<McpResourcePayload[]>([]);

  const {
    appendMessage,
    setChatHistory,
    appendToken,
    setModelFallback,
    appendThinking,
    setThinkingSummary,
    setStreaming,
    setCurrentSessionId,
    setActiveAgent,
    setActiveSkills,
    setResearchProgress,
    setDiscussionProgress,
    setActiveTool,
    finalizeLastAssistant,
    startArtifact,
    appendArtifactDelta,
    endArtifact,
    registerArtifacts,
  } = useAppStore();

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
    };

    // 버퍼에 모인 MCP resource 를 system(notice) 메시지로 flush — 스트림 종료 후에만 호출.
    const flushPendingMcpResources = () => {
      const pending = pendingMcpResourcesRef.current;
      if (pending.length === 0) return;
      pendingMcpResourcesRef.current = [];
      for (const p of pending) {
        // notice:true → 히스토리 payload 제외(백엔드로 안 샘). content 는 sentinel+JSON,
        // message-list 가 프리픽스를 감지해 McpResourceCard 로 렌더한다.
        appendMessage({ role: "system", notice: true, content: encodeMcpResources(p) });
      }
    };

    // 명시적 즉시 재연결 — 현재 소켓을 닫으면 onclose 가 짧은 지연 후 새 핸드셰이크를 연다.
    const reconnectNow = () => {
      reconnectRef.current = 0;
      try {
        wsRef.current?.close();
      } catch {
        /* already closed */
      }
    };

    // 스트림 종료(done/aborted/error) 후 지연된 배포 reload / 토큰 갱신 재연결을 실행.
    const runDeferredAfterStream = () => {
      if (moduleReloadPending) {
        moduleReloadPending = false;
        location.reload();
        return;
      }
      if (reconnectAfterRefreshRef.current) {
        reconnectAfterRefreshRef.current = false;
        reconnectNow();
      }
    };

    // token_warning 처리 — 웹은 HttpOnly 쿠키라 토큰을 못 읽으므로 REST refresh(쿠키 회전) 후
    // WS 를 재연결(새 핸드셰이크가 새 쿠키로 재인증)한다. 스트리밍 중이면 종료 후로 미룬다.
    const refreshAndReconnect = () => {
      if (moduleTokenRefreshing) return;
      moduleTokenRefreshing = true;
      void ApiClient.post("/api/auth/refresh", undefined, { redirectOnUnauthorized: false })
        .then(() => {
          if (useAppStore.getState().isGenerating) reconnectAfterRefreshRef.current = true;
          else reconnectNow();
        })
        .catch(() => {
          /* 갱신 실패(세션 만료 등) — 다음 만료 경고/REST 401 인터셉트 흐름에 위임 */
        })
        .finally(() => {
          moduleTokenRefreshing = false;
        });
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
        case "thinking_summary":
          if (typeof data.summary === "string" && data.summary) setThinkingSummary(data.summary);
          break;
        case "session_created":
          if (data.sessionId) setCurrentSessionId(data.sessionId);
          break;
        case "done":
          // sessionId 는 session_created 이벤트가 담당(done 페이로드엔 없음).
          // cleanedContent 가 있으면 누적 본문을 placeholder 치환본으로 reset(아티팩트 이중 렌더 방지).
          if (data.messageId) finalizeLastAssistant(data.messageId, data.cleanedContent);
          setStreaming(false);
          setResearchProgress(null);
          setDiscussionProgress(null);
          setActiveTool(null);
          flushPendingMcpResources();
          runDeferredAfterStream();
          break;
        case "aborted":
          setStreaming(false);
          setResearchProgress(null);
          setDiscussionProgress(null);
          setActiveTool(null);
          flushPendingMcpResources();
          runDeferredAfterStream();
          break;
        case "error": {
          // 스트리밍 assistant 의 streaming 플래그를 먼저 해소한다(setStreaming 은 마지막
          // 메시지가 assistant 일 때만 clear) — 이후 system 안내를 append 하면 마지막이
          // system 이 되어 잔존 플래그를 못 집는다(커서 깜빡임·피드백 버튼 미표시 회귀).
          setStreaming(false);
          flushPendingMcpResources();
          let errMsg = data.message ?? tRef.current("unknownError");
          if (typeof data.retryAfter === "number" && data.retryAfter > 0) {
            const sec = Math.ceil(data.retryAfter);
            errMsg += ` (약 ${sec}초 후 재시도 가능 / retry in ~${sec}s)`;
          }
          appendMessage({
            role: "system",
            notice: true,
            content: tRef.current("error", { message: errMsg }),
          });
          setResearchProgress(null);
          setDiscussionProgress(null);
          setActiveTool(null);
          runDeferredAfterStream();
          break;
        }
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
        case "discussion_progress": {
          // 토론 모드 진행을 배너로 라이브 표시(research_progress 와 대칭).
          const p = data.progress;
          setDiscussionProgress({
            phase: p.phase,
            currentAgent: p.currentAgent,
            agentEmoji: p.agentEmoji,
            message: p.message ?? "",
            progress: Math.max(0, Math.min(100, Math.round(p.progress ?? 0))),
            roundNumber: p.roundNumber,
            totalRounds: p.totalRounds,
          });
          break;
        }
        case "mcp_tool_start":
          // 도구 실행 시작 — "🔍 {도구} 실행 중" 인디케이터(스트리밍 멈춘 듯한 혼선 해소).
          setActiveTool(data.toolName);
          break;
        case "mcp_tool_result":
          // 도구 결과 도착 — 인디케이터 해제(다음 도구 시작 시 다시 표시).
          setActiveTool(null);
          // resource content 가 있으면 폐기하지 않고 버퍼링 → 스트림 종료 시 카드로 렌더.
          if (Array.isArray(data.resources) && data.resources.length > 0) {
            pendingMcpResourcesRef.current.push({
              toolName: data.toolName,
              resources: data.resources,
            });
          }
          break;
        case "build_id":
          // 배포 감지 — 최초 buildId 를 기억하고, 이후 다른 buildId 재수신 시(재연결로 새 핸드셰이크)
          // 서버가 재배포된 것이므로 구버전 탭을 새로고침한다(스트리밍 중이면 종료 후).
          if (data.buildId) {
            if (moduleKnownBuildId === null) {
              moduleKnownBuildId = data.buildId;
            } else if (moduleKnownBuildId !== data.buildId) {
              if (useAppStore.getState().isGenerating) moduleReloadPending = true;
              else location.reload();
            }
          }
          break;
        case "token_warning":
          // 토큰 만료 임박 — REST refresh(쿠키 회전) 후 재연결로 세션 갱신.
          refreshAndReconnect();
          break;
        case "debug_retained":
          // 오류 본문 임시 보관 고지 — 사용자에게 보이는 안내(히스토리 제외).
          appendMessage({
            role: "system",
            notice: true,
            content: `대화 오류가 디버깅을 위해 약 ${data.ttlHours}시간 보관됩니다. / Error details retained ~${data.ttlHours}h for debugging.`,
          });
          break;
        case "system_event":
          // 백엔드 메타 알림 — 현재는 모델 폴백 고지만 처리한다.
          if (data.payload?.type === "model_fallback") {
            const md = (data.payload.metadata ?? {}) as { from?: string; to?: string; reason?: string };
            setModelFallback({
              from: String(md.from ?? ""),
              to: String(md.to ?? ""),
              ...(md.reason ? { reason: String(md.reason) } : {}),
            });
          }
          break;
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
          const { taskId, status, progress, currentTurn, step } = data;
          const terminal =
            status === "completed" || status === "failed" || status === "cancelled";
          // 스텝 실시간 스트림(4-5) — 있으면 "현재 단계"로 반영(터미널에선 정리).
          const stepExtra: Partial<AgentTaskState> = step
            ? { lastStep: step as AgentTaskState["lastStep"] }
            : {};
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
              let diff: string | undefined;
              let prUrl: string | undefined;
              try {
                const r = await ApiClient.get<{
                  data: { task: { result?: string; git_pr_url?: string; git_repo_url?: string }; steps?: Array<{ step_type: string; content?: string }> };
                }>(`/api/agent-tasks/${taskId}`);
                result = r?.data?.task?.result ?? "";
                prUrl = r?.data?.task?.git_pr_url || undefined;
                // Git 태스크 PR 은 완료 표시 직후(finally, ~수초) 생성된다 — 완료 시점 조회엔 아직
                // 없을 수 있으므로, repo 태스크인데 PR 이 비면 한 번 지연 재조회해 링크를 채운다.
                if (r?.data?.task?.git_repo_url && !prUrl) {
                  setTimeout(() => {
                    void ApiClient.get<{ data: { task: { git_pr_url?: string } } }>(`/api/agent-tasks/${taskId}`)
                      .then((r2) => { const p = r2?.data?.task?.git_pr_url; if (p) merge({ prUrl: p }, undefined); })
                      .catch(() => { /* noop */ });
                  }, 10_000);
                }
                // 코드 작업 diff 스텝 — 채팅 카드에 DiffView 로 인라인 렌더(마지막 diff 사용).
                diff = (r?.data?.steps ?? []).filter((s) => s.step_type === "diff").pop()?.content || undefined;
                // deliverable 아티팩트 — store 등록 후 카드가 칩으로 렌더.
                const arts = (r?.data?.steps ?? [])
                  .filter((s) => s.step_type === "artifact")
                  .map((s) => { try { return JSON.parse(s.content ?? ""); } catch { return null; } })
                  .filter((a): a is { id: string; kind: string; title?: string; lang?: string | null; content?: string } => !!a?.id);
                if (arts.length > 0) {
                  registerArtifacts(arts.map((a) => ({
                    // taskId: task 산출물은 artifacts 테이블이 아닌 스텝 저장분 — 패널의
                    // pdf/docx export 가 task 전용 엔드포인트로 라우팅하는 판별자.
                    id: a.id, kind: a.kind, title: a.title ?? a.id, lang: a.lang ?? null, content: a.content ?? "", streaming: false, taskId,
                  })));
                  for (const a of arts) artifactIds.push(a.id);
                }
              } catch { /* 결과 조회 실패 — 상태만 */ }
              try {
                const f = await ApiClient.get<{ data: { files: string[] } }>(`/api/agent-tasks/${taskId}/files`);
                files = f?.data?.files ?? [];
              } catch { /* 파일 없음 */ }
              merge({ result, artifactIds, files, diff, prUrl, lastStep: undefined }, undefined);
            })();
          } else if (status === "paused") {
            // 승인 대기 — 해당 task 의 pending approval 조회 → 카드에 인라인 승인 버튼.
            void (async () => {
              let mine: PendingApproval[] = [];
              try {
                const r = await ApiClient.get<{ data: { pending: PendingApproval[] } }>(`/api/agent-tasks/approvals/pending`);
                mine = (r?.data?.pending ?? []).filter((p) => p.taskId === taskId);
              } catch { /* 조회 실패 — 상태만 */ }
              merge(stepExtra, mine);
            })();
          } else {
            merge(stepExtra, undefined);
          }
          break;
        }
        default:
          break; // init / stats / update 등 비채팅 메타는 무시
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setStreaming(false);
      if (unmountedRef.current) return;
      // 지수 백오프 재연결 (최대 10회) — 타이머 핸들을 저장해 언마운트 시 취소 가능하게.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    };
  }, [connect]);

  const sendChat = useCallback(
    (message: string, images?: string[], files?: AttachedFileUI[], notebook?: { id: string; title: string } | null) => {
      const s = useAppStore.getState();
      const hasFiles = Array.isArray(files) && files.length > 0;
      // 텍스트가 비어도 첨부 파일만으로 전송 가능
      if ((!message.trim() && !hasFiles) || s.isGenerating) return;

      // 소켓이 OPEN 이 아니면 send() 가 payload 를 조용히 폐기(CLOSED)하거나 throw(CONNECTING)해
      // done/error 이벤트가 오지 않아 UI 가 "분석 중"으로 영구 정지한다. 상태를 오염시키기 전에
      // 차단하고 재연결을 유도한다. (전송 실패한 메시지는 유실 대신 입력창에 남는다)
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        appendMessage({ role: "system", notice: true, content: tRef.current("disconnected") });
        connect();
        return;
      }

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
        // 표시 전용 안내(notice)는 히스토리에서 제외 — system 메시지가 중간 위치로 새어
        // 외부 provider 400(위치 위반)을 유발하는 것을 방지.
        history: s.chatHistory
          .filter((m) => !m.notice)
          .map((m) => ({ role: m.role, content: m.content })),
        sessionId: s.currentSessionId,
        anonSessionId: getAnonSessionId(),
        images: images ?? [],
        // rawFile(브라우저 File)은 WS 직렬화 불가 — 계약 필드만 전송
        files: (files ?? []).map(toWireFile),
        webSearch: s.webSearchEnabled,
        deepResearchMode: s.deepResearchMode,
        discussionMode: s.discussionMode,
        thinkingMode: s.thinkingEnabled,
        imageMode: s.imageMode,
        artifactMode: s.artifactMode,
        style: s.style,
        enabledTools: s.mcpToolsEnabled,
        // NotebookLM 컨텍스트 — grounding 프리픽스 주입은 백엔드(prompts/notebook-context) 담당
        notebook: notebook ?? undefined,
        // 개인정보 설정 — 백엔드(ws-chat-handler)가 존중: false 면 기록 저장/메모리 학습 생략.
        saveHistory: s.saveHistory,
        memoryLearning: s.memoryLearning,
        // 커스텀 에이전트(페르소나) 적용 — 지정 시 백엔드가 산업 에이전트 자동라우팅을 우회하고 해당 system_prompt 주입.
        userAgentId: s.activeUserAgent?.id,
      };
      ws.send(JSON.stringify(payload));

      // 가로채기(bypass) 모드가 켜져 있으면 도구·아티팩트가 이번 응답에 적용되지 않으므로,
      // 스트리밍 직전에 표시 전용 안내를 삽입한다(notice: true → history payload 제외).
      if (s.discussionMode || s.deepResearchMode || s.imageMode) {
        appendMessage({ role: "system", content: tRef.current("interceptNotice"), notice: true });
      }
    },
    [appendMessage, setStreaming, setActiveAgent, setActiveSkills, connect],
  );

  const abort = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "abort" }));
    // 구조화 답변(REST) 진행 중이면 fetch 도 취소
    structuredAbortRef.current?.abort();
  }, []);

  // 에이전트 토글 ON: 메시지를 목표(goal)로 자율 에이전트 작업을 생성·실행한다.
  // (채팅 WS 가 아니라 REST POST /api/agent-tasks + /execute — 진행상황은 '에이전트 작업' 페이지)
  // 첨부 files 는 백엔드가 텍스트 추출 후 작업 샌드박스 workspace 에 주입,
  // images(dataURL)는 goal 메시지의 vision 채널로 전달된다.
  const startAgentTask = useCallback(
    async (
      message: string,
      files?: AttachedFileUI[],
      images?: string[],
      approvalPolicy?: "all" | "high-risk" | "none",
      repoUrl?: string,
      /** Cowork D2: true 면 데스크톱 브리지가 연결한 로컬 폴더에서 실행 (승인은 서버가 'all' 강제) */
      localExecutor?: boolean,
    ) => {
      const goal = message.trim();
      const s = useAppStore.getState();
      if (!goal || s.isGenerating) return;
      appendMessage({ role: "user", content: goal });
      try {
        // 바이너리 원본(rawFile)이 있으면 multipart 로 스트리밍 업로드 — base64-in-JSON 의
        // 크기/메모리 한계를 피하는 근본 경로. 텍스트 첨부·이미지는 payload JSON 에 동승.
        // 단, 합계가 Cloudflare 요청당 상한(100MB)을 넘보면 청크 업로드로 전환 —
        // 파일별로 조각 업로드 후 uploadId 참조만 담은 JSON 으로 작업을 생성한다.
        const binaryParts = (files ?? []).filter((f) => f.rawFile);
        const totalBinaryBytes = binaryParts.reduce((sum, f) => sum + (f.rawFile?.size ?? 0), 0);
        let created: { data?: { task?: { id?: string } } } | null;
        if (totalBinaryBytes > CHUNKED_UPLOAD_THRESHOLD_BYTES) {
          const uploadRefs = [];
          for (const f of binaryParts) {
            const uploadId = await uploadFileInChunks(f.rawFile!);
            uploadRefs.push({ name: f.name, type: f.type, size: f.rawFile!.size, uploadId });
          }
          const payloadFiles = (files ?? []).filter((f) => !f.rawFile).map(toWireFile);
          created = await ApiClient.post<{ data: { task: { id: string } } }>(
            "/api/agent-tasks",
            {
              goal,
              files: [...payloadFiles, ...uploadRefs],
              ...(images && images.length > 0 ? { images } : {}),
              ...(repoUrl && repoUrl.trim() ? { repoUrl: repoUrl.trim() } : {}),
              ...(localExecutor ? { executor: "local" } : {}),
            },
          );
        } else if (binaryParts.length > 0) {
          const payloadFiles = (files ?? [])
            .filter((f) => !f.rawFile)
            .map(toWireFile);
          const fd = new FormData();
          fd.append("payload", JSON.stringify({
            goal,
            ...(payloadFiles.length > 0 ? { files: payloadFiles } : {}),
            ...(images && images.length > 0 ? { images } : {}),
            ...(repoUrl && repoUrl.trim() ? { repoUrl: repoUrl.trim() } : {}),
            ...(localExecutor ? { executor: "local" } : {}),
          }));
          for (const f of binaryParts) fd.append("files", f.rawFile!, f.name);
          const resp = await fetch("/api/agent-tasks", {
            method: "POST",
            credentials: "include",
            headers: { ...(await csrfHeaders()) },
            body: fd,
          });
          const body = await resp.json().catch(() => null);
          if (!resp.ok) {
            const detail = (body as { error?: { message?: string } } | null)?.error?.message;
            throw new Error(detail || `HTTP ${resp.status}`);
          }
          created = body as { data?: { task?: { id?: string } } };
        } else {
          created = await ApiClient.post<{ data: { task: { id: string } } }>(
            "/api/agent-tasks",
            {
              goal,
              ...(files && files.length > 0
                ? { files: files.map(toWireFile) }
                : {}),
              ...(images && images.length > 0 ? { images } : {}),
              ...(repoUrl && repoUrl.trim() ? { repoUrl: repoUrl.trim() } : {}),
              ...(localExecutor ? { executor: "local" } : {}),
            },
          );
        }
        const taskId = created?.data?.task?.id;
        if (!taskId) throw new Error(tRef.current("taskIdMissing"));
        // 진행상황 카드 — agent_task_progress 이벤트로 taskId 로 식별해 라이브 업데이트.
        appendMessage({
          role: "assistant",
          taskId,
          content: "",
          agentTask: { goal, status: "pending", currentTurn: 0, progress: 0 },
        });
        // 승인 3모드 — all(기본)이면 전역 정책이므로 미전송, 그 외만 이 실행에 override 전달.
        await ApiClient.post(
          `/api/agent-tasks/${taskId}/execute`,
          approvalPolicy && approvalPolicy !== "all" ? { approvalPolicy } : {},
        );
      } catch (e) {
        appendMessage({
          role: "assistant",
          content: tRef.current("agentTaskStartFailed", {
            message: e instanceof Error ? e.message : String(e),
          }),
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
            ? tRef.current("structuredAborted")
            : tRef.current("structuredFailed", {
                message: e instanceof Error ? e.message : String(e),
              }),
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
