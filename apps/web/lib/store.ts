import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import type {
  ChatMessage as SharedChatMessage,
  ChatRole,
  SearchSourceRef,
  UserRole,
} from "@openmake/shared-types";

/**
 * 채팅 메시지 (기존 state.js chatHistory 항목 대응).
 * shared-types ChatMessage 를 기반으로 store 고유 필드(streaming)만 확장한다.
 */
interface ChatMessage extends Pick<SharedChatMessage, "role" | "content" | "images"> {
  /** 서버 messageId (WS done 이벤트) — 메시지 피드백(👍/👎) 전송용 (assistant 메시지). */
  id?: string;
  /** 히스토리에서 불러온 DB 메시지 id — "여기서 분기"(clone uptoMessageId) 기준점. 스트리밍 중 메시지엔 없다. */
  dbId?: string;
  /** 스트리밍 진행 중 여부 (assistant 메시지) */
  streaming?: boolean;
  /** 에이전트 작업 메시지 — agent_task_progress 로 라이브 업데이트되는 메시지 식별자 */
  taskId?: string;
  /** 추론(thinking) 내용 — ws thinking 이벤트로 누적, 타임라인 블록으로 표시 */
  reasoning?: string;
  /** 추론 요약 헤드라인 — 생각 종료 시 별도 모델이 생성 (ws thinking_summary, 클로드 웹식) */
  reasoningSummary?: string;
  /**
   * 답변 검증 지적 — done 이후 judge 모델이 1회 점검한 결과(ws answer_verification).
   * 지적이 없으면 이벤트가 오지 않으므로 이 필드도 비어 있다. 자동 수정은 하지 않는다.
   */
  verificationIssues?: string;
  /** 구조화 답변 데이터 (structuredMode=true 시 REST /api/chat/structured 응답). 있으면 카드 UI 로 렌더. */
  structured?: StructuredAnswerData;
  /** 에이전트 작업이 승인 대기(paused)일 때 표시할 대기 중 도구 호출 — 채팅 인라인 승인. */
  approvals?: PendingApproval[];
  /** 에이전트 작업 구조화 상태 — 채팅 인라인 카드(AgentTaskCard)로 렌더(이모지 대신 벡터 아이콘). */
  agentTask?: AgentTaskState;
  /** 표시 전용 시스템 안내(예: 가로채기 모드 안내) — 백엔드 history payload 에는 제외(스냅샷 전용). */
  notice?: boolean;
  /** user 메시지에 파일 첨부가 있었음 — 첨부 원본은 히스토리 미보존이라 재생성 대상에서 제외. */
  hasAttachments?: boolean;
  /**
   * 모델 폴백 고지 — 선택한 모델이 실패해 다른 모델이 답한 경우.
   * 표시가 없으면 사용자가 "선택한 모델이 답했다"고 오인한다(실측).
   */
  modelFallback?: { from: string; to: string; reason?: string; code?: string };
  /** 웹검색 출처(F19.4) — 본문 [N] 인용 칩. ws search_sources 또는 히스토리 로드. 히스토리 payload 에는 싣지 않는다 */
  sources?: SearchSourceRef[];
}

/** 에이전트 작업 인라인 카드 상태. */
export interface AgentTaskState {
  goal: string;
  status: string; // pending | running | paused | completed | failed | cancelled
  currentTurn: number;
  progress: number;
  /** 완료 시 결과 본문(markdown). */
  result?: string;
  /** 완료 시 deliverable 아티팩트 id 목록(store 에 등록됨 → 칩 렌더). */
  artifactIds?: string[];
  /** 완료 시 workspace 산출물 파일 경로 목록. */
  files?: string[];
  /** 완료 시 코드 작업(openmake_code) git diff — 있으면 카드에 DiffView 로 렌더. */
  diff?: string;
  /** 방금 실행된 스텝 요약(4-5 실시간 스트림) — "현재 단계" 라인 표시. */
  lastStep?: { stepType: string; toolName?: string; preview?: string };
}

/** 에이전트 작업 도구 호출 승인 대기 (백엔드 approval-gate PendingApproval 대응). */
export interface PendingApproval {
  approvalId: string;
  taskId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** 실행 전 미리보기(unified diff, 138) — 파일 쓰기 도구만 */
  preview?: string;
}

/** 채팅 모드(add-on) 진행상황 — 모양은 그 모드의 웹 add-on 이 정한다(addons/types.ts ChatModeExtension.toProgress). */
interface ModeProgressInfo {
  modeId: string;
  progress: unknown;
}

/** 오케스트레이터 작업 1건 (백엔드 orchestrator_plan/orchestrator_task 이벤트의 task 대응). */
interface OrchestratorTaskInfo {
  id: string;
  capability: string;
  instruction?: string;
  status: "pending" | "running" | "ok" | "failed";
  summary?: string;
  ms?: number;
}

/**
 * 멀티모달 오케스트레이터 진행상황 (ws system_event payload.type=orchestrator_status|plan|task).
 * phase 는 status 이벤트, tasks 는 plan 으로 채워지고 task 이벤트로 상태가 갱신된다.
 */
interface OrchestratorProgressInfo {
  phase: "planning" | "executing" | "synthesizing";
  detail?: string;
  complexity?: string;
  tasks: OrchestratorTaskInfo[];
}

/**
 * 구조화 답변 (백엔드 schemas/structured-answer.schema.ts StructuredAnswer 대응).
 * structuredMode 에서 POST /api/chat/structured 가 반환. content 에는 동일 내용의 markdown 도 함께 저장된다.
 */
export interface StructuredAnswerData {
  intent: string;
  title: string;
  conclusion: string;
  summary?: string;
  sections: {
    heading: string;
    body: string;
    bullets?: string[];
    table?: { headers: string[]; rows: string[][] };
  }[];
  risks?: string[];
  action_items?: string[];
  confidence: "high" | "medium" | "low";
}

export type { ChatRole };

/**
 * 아티팩트 (claude.ai-style 산출물). 백엔드 ws artifact_* 스트림으로 누적되거나
 * REST GET /api/sessions/:sid/artifacts 로 복원된다.
 */
export interface Artifact {
  id: string;
  kind: string;
  title: string;
  lang: string | null;
  content: string;
  /** 스트리밍 진행 중 (artifact_start ~ artifact_end) */
  streaming?: boolean;
  /** Agent Task 산출물이면 원본 task id — 세션 artifacts 테이블이 아닌 스텝 저장분이라
   *  export(pdf/docx)가 task 전용 엔드포인트를 타야 한다. 채팅 아티팩트는 미설정. */
  taskId?: string;
}

type ChatStyle = "concise" | "default" | "verbose";

/** 추론 강도 — thinkingEnabled 가 켜졌을 때만 의미. 백엔드 ws `thinkingLevel` 계약과 1:1. */
type ThinkingLevel = "low" | "medium" | "high";

/** store 인증 사용자 — shared-types User 의 표시용 부분집합 (name 은 username 매핑). */
interface AuthUser {
  id: string;
  email: string;
  name?: string;
  role: UserRole;
  /** 활성 조직 (F22) — 없으면 null. 조직 공유 자원 노출·공유 토글 표시 조건. */
  activeOrgId?: string | null;
  activeOrgRole?: "owner" | "admin" | "member" | null;
}

interface AppState {
  // 채팅
  chatHistory: ChatMessage[];
  currentSessionId: string | null;
  isGenerating: boolean;
  /** empty state 빠른 시작 카드 → composer prefill 용 드래프트 */
  inputDraft: string;
  /** 현재 응답에 선택된 에이전트 + 활성 스킬 (ws agent_selected / skills_activated) */
  activeAgent: { name: string; emoji?: string } | null;
  activeSkills: string[];
  /** 사용자가 채팅에 적용한 커스텀 에이전트(페르소나). 지정 시 WS userAgentId 로 전송돼 백엔드가 해당 system_prompt 를 주입. 네비게이션·재방문에 유지되도록 영속. */
  activeUserAgent: { id: string; name: string; icon?: string | null } | null;
  /** add-on 컨텍스트 참조(컴포저 선택기, add-on id → 참조) — 같은 대화 내에서만 유지. 대화 전환/새 대화 시 리셋(clearChat + 로드 지점) — 다른 대화로 누수되면 무관한 질문까지 그 add-on 의 도구로 유도된다. */
  contextRefs: Record<string, { id: string; title: string }>;
  /** 실행 중인 채팅 모드의 진행상황 — 생성 중에만 값이 있다 */
  modeProgress: ModeProgressInfo | null;
  /** 오케스트레이터 진행상황 (ws system_event orchestrator_*) — 스트리밍 중 배너로 표시, done/skipped 시 clear. */
  orchestratorProgress: OrchestratorProgressInfo | null;
  /** 현재 실행 중인 MCP/내장 도구명 (ws mcp_tool_start→표시, mcp_tool_result/done→clear). */
  activeTool: string | null;
  /**
   * 재생성 요청 — MessageList(소켓 미보유)가 등록하고 Composer(단일 소켓 보유)가 처리.
   * fromIndex 이후 히스토리를 잘라낸 뒤 content/images 를 재전송한다.
   */
  resendRequest: { fromIndex: number; content: string; images?: string[] } | null;

  // 아티팩트
  artifacts: Artifact[];
  activeArtifactId: string | null;
  artifactPanelOpen: boolean;

  // 모드 토글 (기존 state.js)
  thinkingEnabled: boolean;
  /** 추론 강도 — thinkingEnabled=true 일 때 전송. 모델별 지원값 정규화는 서버 담당. */
  thinkingLevel: ThinkingLevel;
  /** 답변 검증 — 켜면 done 이후 judge 모델이 1회 점검(비용 발생). 기본 off. */
  answerVerification: boolean;
  /** 켜진 채팅 모드의 add-on id — 모드끼리·에이전트 작업 모드와 상호배타. 요청에 modes[<id>]=true 로 실린다 */
  activeChatMode: string | null;
  agentTaskMode: boolean;
  /** 에이전트 작업 승인 3모드 — all=Manual(전부 승인·기본)·high-risk=Auto(고위험만)·none=Skip(전부 자동). */
  agentApprovalMode: "all" | "high-risk" | "none";
  /** 에이전트 작업 Git repo URL(Phase 2) — 있으면 태스크가 해당 repo 를 clone 해 작업 후 PR 생성. */
  /** Cowork D2: 로컬 실행 토글 — ON 이면 작업이 데스크톱 앱이 연결한 폴더에서 실행(executor='local'). */
  agentLocalExecutor: boolean;
  /** 다중 디바이스(101): 로컬 실행 대상 브리지 디바이스 id — null 은 최근 접속 디바이스 폴백. */
  agentLocalDeviceId: string | null;
  /** 폴더 선택(102): 로컬 실행 폴더 — 연결 루트 기준 상대경로. null 은 루트. */
  agentLocalFolderRel: string | null;
  mcpToolsEnabled: Record<string, boolean>;

  // 개인정보 설정 (설정 페이지 · 서버 preferences 영속) — 채팅 WS 메시지로 전송돼 백엔드가 존중.
  saveHistory: boolean; // false 면 서버가 대화 기록 저장 생략
  memoryLearning: boolean; // false 면 메모리 학습 비활성 (saveHistory 와 독립)

  // 모델 / 스타일
  selectedModel: string; // 'default' = 자동
  style: ChatStyle;

  // 인증
  auth: { currentUser: AuthUser | null; isGuestMode: boolean };
  /** /api/auth/me 1회 동기화가 끝났는가 — 끝나기 전엔 게스트로 보이므로 role 가드가 판정을 미룬다 */
  authResolved: boolean;

  // actions
  setChatHistory: (fn: (prev: ChatMessage[]) => ChatMessage[]) => void;
  appendMessage: (m: ChatMessage) => void;
  appendToken: (token: string) => void;
  /** 재연결 이어받기 — 마지막 assistant 본문을 서버 스냅샷으로 되돌리고 스트리밍 상태로 복귀 */
  resumeAssistant: (content: string, reasoning?: string) => void;
  /** 진행 중(또는 마지막) assistant 메시지에 모델 폴백 고지를 부착 */
  setModelFallback: (info: { from: string; to: string; reason?: string }) => void;
  appendThinking: (token: string) => void;
  setThinkingSummary: (summary: string) => void;
  setVerificationIssues: (issues: string) => void;
  setMessageSources: (sources: SearchSourceRef[]) => void;
  setStreaming: (v: boolean) => void;
  setCurrentSessionId: (id: string | null) => void;
  setInputDraft: (t: string) => void;
  setActiveAgent: (a: { name: string; emoji?: string } | null) => void;
  setActiveSkills: (s: string[]) => void;
  setActiveUserAgent: (a: { id: string; name: string; icon?: string | null } | null) => void;
  /** add-on 컨텍스트 참조 설정 — ref 가 null 이면 그 add-on 의 참조를 지운다 */
  setContextRef: (addonId: string, ref: { id: string; title: string } | null) => void;
  clearContextRefs: () => void;
  setModeProgress: (p: ModeProgressInfo | null) => void;
  /** 채팅 모드 토글 — 켜면 다른 모드와 에이전트 작업 모드는 꺼진다 */
  toggleChatMode: (addonId: string) => void;
  setOrchestratorProgress: (p: OrchestratorProgressInfo | null) => void;
  /** orchestrator_task 이벤트 — 같은 id 의 작업 상태를 갱신(plan 을 못 받았으면 추가). */
  updateOrchestratorTask: (task: OrchestratorTaskInfo) => void;
  setActiveTool: (t: string | null) => void;
  requestResend: (r: { fromIndex: number; content: string; images?: string[] }) => void;
  clearResendRequest: () => void;
  setPrivacyPrefs: (patch: { saveHistory?: boolean; memoryLearning?: boolean }) => void;
  /** WS done 시 마지막 assistant 메시지에 서버 messageId 부여(+cleanedContent 시 본문 reset) — 피드백 전송용. */
  finalizeLastAssistant: (messageId: string, cleanedContent?: string) => void;
  clearChat: () => void;

  // 아티팩트 actions
  startArtifact: (meta: Omit<Artifact, "content" | "streaming">) => void;
  appendArtifactDelta: (id: string, delta: string) => void;
  endArtifact: (id: string) => void;
  setActiveArtifact: (id: string | null) => void;
  setArtifactPanelOpen: (v: boolean) => void;
  setArtifacts: (list: Artifact[]) => void;
  /** 완료된 아티팩트들을 패널 자동 오픈 없이 store 에 등록(dedup by id) — 에이전트 작업 인라인용. */
  registerArtifacts: (list: Artifact[]) => void;

  toggle: (
    key:
      | "thinkingEnabled"
      | "answerVerification"
      | "agentTaskMode",
  ) => void;
  setSelectedModel: (m: string) => void;
  setAgentApprovalMode: (m: "all" | "high-risk" | "none") => void;
  setAgentLocalExecutor: (v: boolean) => void;
  setAgentLocalDeviceId: (v: string | null) => void;
  setAgentLocalFolderRel: (v: string | null) => void;
  cycleStyle: () => void;
  setStyle: (m: ChatStyle) => void;
  cycleThinkingLevel: () => void;
  setThinkingLevel: (v: ThinkingLevel) => void;
  setAuth: (auth: AppState["auth"]) => void;
  setAuthResolved: (v: boolean) => void;
}

const STYLE_ORDER: ChatStyle[] = ["default", "concise", "verbose"];
// 낮음 → 보통 → 높음 순환. 기본 medium (기존 서버 폴백 high 보다 보수적 — 추론 토큰 낭비 억제).
const THINKING_LEVEL_ORDER: ThinkingLevel[] = ["low", "medium", "high"];

/**
 * primary(전용) 모드 — 상호배타. 하나를 켜면 나머지는 자동으로 꺼진다.
 * 백엔드 message-pipeline 은 primary 모드 "하나"만 실행하고 나머지는 조용히 무시하므로,
 * 동시 활성 시 UI 에는 켜진 것처럼 보이지만 실제로는 안 먹는 착시를 제거하기 위함.
 */
const PRIMARY_MODE_KEYS = [
  "agentTaskMode",
] as const;

/** SSR(서버 평가) 시 localStorage 부재로 인한 ReferenceError 방지 — 클라에서만 실제 저장소 사용. */
const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
  chatHistory: [],
  currentSessionId: null,
  isGenerating: false,
  inputDraft: "",
  activeAgent: null,
  activeSkills: [],
  activeUserAgent: null,
  contextRefs: {},
  modeProgress: null,
  orchestratorProgress: null,
  activeTool: null,
  resendRequest: null,

  artifacts: [],
  activeArtifactId: null,
  artifactPanelOpen: false,

  thinkingEnabled: true, // 기본 ON — tool calling 중 추론(thinking) 과정을 화면에 노출
  thinkingLevel: "medium",
  answerVerification: false,
  activeChatMode: null,
  agentTaskMode: false,
  agentApprovalMode: "all",
  agentLocalExecutor: false,
  agentLocalDeviceId: null,
  agentLocalFolderRel: null,
  mcpToolsEnabled: {},

  saveHistory: true,
  memoryLearning: true,

  selectedModel: "default",
  style: "default",

  auth: { currentUser: null, isGuestMode: true },
  authResolved: false,

  setPrivacyPrefs: (patch) => set(() => ({ ...patch })),
  finalizeLastAssistant: (messageId, cleanedContent) =>
    set((s) => {
      const hist = [...s.chatHistory];
      for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i].role === "assistant") {
          // cleanedContent: 아티팩트 승격 시 raw 코드펜스가 placeholder 로 치환된 본문 —
          // 클라가 token 단위로 누적한 원문을 이걸로 reset 해 펜스 원문+아티팩트 칩 이중 렌더를 막는다.
          hist[i] = {
            ...hist[i],
            id: messageId,
            ...(typeof cleanedContent === "string" ? { content: cleanedContent } : {}),
          };
          break;
        }
      }
      return { chatHistory: hist };
    }),
  setChatHistory: (fn) => set((s) => ({ chatHistory: fn(s.chatHistory) })),
  appendMessage: (m) => set((s) => ({ chatHistory: [...s.chatHistory, m] })),
  setModelFallback: (info) =>
    set((s) => {
      const hist = [...s.chatHistory];
      // 스트리밍 시작 전에 도착할 수 있으므로, 없으면 자리표시 assistant 를 만들지 않고
      // 다음 토큰이 붙을 메시지에 적용되도록 빈 assistant 를 하나 준비한다.
      const last = hist[hist.length - 1];
      if (last && last.role === "assistant" && last.streaming) {
        hist[hist.length - 1] = { ...last, modelFallback: info };
      } else {
        hist.push({ role: "assistant", content: "", streaming: true, modelFallback: info });
      }
      return { chatHistory: hist };
    }),
  appendToken: (token) =>
    set((s) => {
      const hist = [...s.chatHistory];
      const last = hist[hist.length - 1];
      if (last && last.role === "assistant" && last.streaming) {
        hist[hist.length - 1] = { ...last, content: last.content + token };
      } else {
        hist.push({ role: "assistant", content: token, streaming: true });
      }
      return { chatHistory: hist };
    }),
  resumeAssistant: (content, reasoning) =>
    set((s) => {
      const hist = [...s.chatHistory];
      const last = hist[hist.length - 1];
      if (last && last.role === "assistant") {
        hist[hist.length - 1] = {
          ...last,
          content,
          ...(reasoning ? { reasoning } : {}),
          streaming: true,
        };
      } else {
        hist.push({ role: "assistant", content, ...(reasoning ? { reasoning } : {}), streaming: true });
      }
      return { chatHistory: hist, isGenerating: true };
    }),
  appendThinking: (token) =>
    set((s) => {
      const hist = [...s.chatHistory];
      const last = hist[hist.length - 1];
      if (last && last.role === "assistant" && last.streaming) {
        hist[hist.length - 1] = { ...last, reasoning: (last.reasoning || "") + token };
      } else {
        // thinking 은 보통 답변 토큰보다 먼저 도착 — assistant placeholder 를 생성해 누적
        hist.push({ role: "assistant", content: "", reasoning: token, streaming: true });
      }
      return { chatHistory: hist };
    }),
  setMessageSources: (sources) =>
    set((s) => {
      // 사전 주입 검색은 첫 토큰보다 먼저 온다 — 스트리밍 assistant 가 없으면 placeholder 를 만들어 부착(appendThinking 과 같은 규칙)
      const hist = [...s.chatHistory];
      const last = hist[hist.length - 1];
      if (last && last.role === "assistant" && last.streaming) hist[hist.length - 1] = { ...last, sources };
      else hist.push({ role: "assistant", content: "", sources, streaming: true });
      return { chatHistory: hist };
    }),
  setVerificationIssues: (issues) =>
    set((s) => {
      // done 이후 도착 — 마지막 assistant 메시지에 부착.
      const hist = [...s.chatHistory];
      for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i].role === "assistant") {
          hist[i] = { ...hist[i], verificationIssues: issues };
          break;
        }
      }
      return { chatHistory: hist };
    }),
  setThinkingSummary: (summary) =>
    set((s) => {
      // 요약은 스트리밍 중(첫 토큰 직후) 또는 done 직후 도착 — 마지막 assistant 에 부착
      const hist = [...s.chatHistory];
      for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i].role === "assistant") {
          hist[i] = { ...hist[i], reasoningSummary: summary };
          break;
        }
      }
      return { chatHistory: hist };
    }),
  setStreaming: (v) =>
    set((s) => {
      const hist = [...s.chatHistory];
      const last = hist[hist.length - 1];
      if (last && last.role === "assistant") {
        hist[hist.length - 1] = { ...last, streaming: v };
      }
      return { chatHistory: hist, isGenerating: v };
    }),
  setCurrentSessionId: (id) => set({ currentSessionId: id }),
  setInputDraft: (t) => set({ inputDraft: t }),
  setActiveAgent: (a) => set({ activeAgent: a }),
  setActiveSkills: (s) => set({ activeSkills: s }),
  setActiveUserAgent: (a) => set({ activeUserAgent: a }),
  setContextRef: (addonId, ref) => set((s) => {
    const next = { ...s.contextRefs };
    if (ref) next[addonId] = ref; else delete next[addonId];
    return { contextRefs: next };
  }),
  clearContextRefs: () => set({ contextRefs: {} }),
  setModeProgress: (p) => set({ modeProgress: p }),
  toggleChatMode: (addonId) =>
    set((s) => (s.activeChatMode === addonId ? { activeChatMode: null } : { activeChatMode: addonId, agentTaskMode: false })),
  setOrchestratorProgress: (p) => set({ orchestratorProgress: p }),
  updateOrchestratorTask: (task) =>
    set((s) => {
      const cur = s.orchestratorProgress;
      if (!cur) return {};
      const idx = cur.tasks.findIndex((t) => t.id === task.id);
      const tasks =
        idx >= 0
          ? cur.tasks.map((t, i) => (i === idx ? { ...t, ...task } : t))
          : [...cur.tasks, task];
      return { orchestratorProgress: { ...cur, tasks } };
    }),
  setActiveTool: (t) => set({ activeTool: t }),
  requestResend: (r) => set({ resendRequest: r }),
  clearResendRequest: () => set({ resendRequest: null }),
  clearChat: () =>
    set({
      chatHistory: [],
      currentSessionId: null,
      activeAgent: null,
      activeSkills: [],
      contextRefs: {},
      modeProgress: null,
      orchestratorProgress: null,
      activeTool: null,
      resendRequest: null,
      artifacts: [],
      activeArtifactId: null,
      artifactPanelOpen: false,
    }),

  startArtifact: (meta) =>
    set((s) => {
      const existing = s.artifacts.findIndex((a) => a.id === meta.id);
      const next: Artifact = { ...meta, content: "", streaming: true };
      const artifacts =
        existing >= 0
          ? s.artifacts.map((a, i) => (i === existing ? next : a))
          : [...s.artifacts, next];
      return { artifacts, activeArtifactId: meta.id, artifactPanelOpen: true };
    }),
  appendArtifactDelta: (id, delta) =>
    set((s) => ({
      artifacts: s.artifacts.map((a) =>
        a.id === id ? { ...a, content: a.content + delta } : a,
      ),
    })),
  endArtifact: (id) =>
    set((s) => ({
      artifacts: s.artifacts.map((a) => (a.id === id ? { ...a, streaming: false } : a)),
    })),
  setActiveArtifact: (id) => set({ activeArtifactId: id }),
  setArtifactPanelOpen: (v) => set({ artifactPanelOpen: v }),
  setArtifacts: (list) =>
    set((s) => ({
      artifacts: list,
      activeArtifactId: list.length > 0 ? (s.activeArtifactId ?? list[list.length - 1].id) : null,
    })),
  registerArtifacts: (list) =>
    set((s) => {
      // 패널 자동 오픈 없이 append (dedup by id).
      const ids = new Set(s.artifacts.map((a) => a.id));
      const added = list.filter((a) => !ids.has(a.id));
      return added.length > 0 ? { artifacts: [...s.artifacts, ...added] } : {};
    }),

  toggle: (key) =>
    set((s) => {
      const next = !s[key];
      // primary 모드를 켤 때만 나머지 primary 모드를 자동 off (상호배타).
      // 끄는 경우·비-primary(thinking·답변 검증) 토글은 단순 flip.
      if (next && (PRIMARY_MODE_KEYS as readonly string[]).includes(key)) {
        const cleared: Record<string, boolean> = {};
        for (const k of PRIMARY_MODE_KEYS) {
          if (k !== key) cleared[k] = false;
        }
        cleared[key] = true;
        // 채팅 모드(add-on)와도 상호배타 — 백엔드는 primary 모드 하나만 실행한다
        return { ...cleared, activeChatMode: null } as Partial<AppState>;
      }
      return { [key]: next } as Partial<AppState>;
    }),
  setSelectedModel: (m) => set({ selectedModel: m }),
  setAgentApprovalMode: (m) => set({ agentApprovalMode: m }),
  setAgentLocalExecutor: (v) => set({ agentLocalExecutor: v }),
  // 디바이스 변경 시 폴더 선택은 리셋 — 다른 디바이스의 경로가 남지 않게.
  setAgentLocalDeviceId: (v) => set({ agentLocalDeviceId: v, agentLocalFolderRel: null }),
  setAgentLocalFolderRel: (v) => set({ agentLocalFolderRel: v }),
  cycleStyle: () =>
    set((s) => ({
      style: STYLE_ORDER[(STYLE_ORDER.indexOf(s.style) + 1) % STYLE_ORDER.length],
    })),
  setStyle: (m) => set({ style: m }),
  cycleThinkingLevel: () =>
    set((s) => ({
      thinkingLevel:
        THINKING_LEVEL_ORDER[
          (THINKING_LEVEL_ORDER.indexOf(s.thinkingLevel) + 1) % THINKING_LEVEL_ORDER.length
        ],
    })),
  setThinkingLevel: (v) => set({ thinkingLevel: v }),
  setAuth: (auth) => set({ auth }),
  setAuthResolved: (v) => set({ authResolved: v }),
    }),
    {
      name: "openmake-prefs",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : noopStorage,
      ),
      // 사용자 환경설정만 영속화 — 채팅/아티팩트 등 휘발성 세션 상태는 제외
      partialize: (s) => ({ selectedModel: s.selectedModel, style: s.style, thinkingLevel: s.thinkingLevel, answerVerification: s.answerVerification, activeUserAgent: s.activeUserAgent }),
    },
  ),
);
