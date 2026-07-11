import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import type {
  ChatMessage as SharedChatMessage,
  ChatRole,
  UserRole,
} from "@openmake/shared-types";

/**
 * 채팅 메시지 (기존 state.js chatHistory 항목 대응).
 * shared-types ChatMessage 를 기반으로 store 고유 필드(streaming)만 확장한다.
 */
export interface ChatMessage extends Pick<SharedChatMessage, "role" | "content" | "images"> {
  /** 서버 messageId (WS done 이벤트) — 메시지 피드백(👍/👎) 전송용 (assistant 메시지). */
  id?: string;
  /** 스트리밍 진행 중 여부 (assistant 메시지) */
  streaming?: boolean;
  /** 에이전트 작업 메시지 — agent_task_progress 로 라이브 업데이트되는 메시지 식별자 */
  taskId?: string;
  /** 추론(thinking) 내용 — ws thinking 이벤트로 누적, 화면에 접이식 블록으로 표시 */
  reasoning?: string;
  /** 구조화 답변 데이터 (structuredMode=true 시 REST /api/chat/structured 응답). 있으면 카드 UI 로 렌더. */
  structured?: StructuredAnswerData;
  /** 에이전트 작업이 승인 대기(paused)일 때 표시할 대기 중 도구 호출 — 채팅 인라인 승인. */
  approvals?: PendingApproval[];
  /** 에이전트 작업 구조화 상태 — 채팅 인라인 카드(AgentTaskCard)로 렌더(이모지 대신 벡터 아이콘). */
  agentTask?: AgentTaskState;
  /** 표시 전용 시스템 안내(예: 가로채기 모드 안내) — 백엔드 history payload 에는 제외(스냅샷 전용). */
  notice?: boolean;
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
  /** 방금 실행된 스텝 요약(4-5 실시간 스트림) — "현재 단계" 라인 표시. */
  lastStep?: { stepType: string; toolName?: string; preview?: string };
}

/** 에이전트 작업 도구 호출 승인 대기 (백엔드 approval-gate PendingApproval 대응). */
export interface PendingApproval {
  approvalId: string;
  taskId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/** 딥리서치 진행상황 (백엔드 research_progress 이벤트 — DeepResearch ResearchProgress 대응). */
export interface ResearchProgressInfo {
  currentStep: string;
  progress: number;
  message: string;
  currentLoop: number;
  totalLoops: number;
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
}

export type ChatStyle = "concise" | "default" | "verbose";

/** store 인증 사용자 — shared-types User 의 표시용 부분집합 (name 은 username 매핑). */
export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  role: UserRole;
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
  /** 딥리서치 진행상황 (ws research_progress) — 스트리밍 중 상태 배너로 표시, done 시 clear. */
  researchProgress: ResearchProgressInfo | null;

  // 아티팩트
  artifacts: Artifact[];
  activeArtifactId: string | null;
  artifactPanelOpen: boolean;

  // 모드 토글 (기존 state.js)
  thinkingEnabled: boolean;
  discussionMode: boolean;
  deepResearchMode: boolean;
  webSearchEnabled: boolean;
  agentTaskMode: boolean;
  imageMode: boolean;
  artifactMode: boolean;
  /** 구조화 답변 모드 — ON 시 메시지를 REST /api/chat/structured 로 보내 카드 UI 로 렌더(비스트리밍). */
  structuredMode: boolean;
  mcpToolsEnabled: Record<string, boolean>;

  // 개인정보 설정 (설정 페이지 · 서버 preferences 영속) — 채팅 WS 메시지로 전송돼 백엔드가 존중.
  saveHistory: boolean; // false 면 서버가 대화 기록 저장 생략
  memoryLearning: boolean; // false 면 메모리 학습 비활성 (saveHistory 와 독립)

  // 모델 / 스타일
  selectedModel: string; // 'default' = 자동
  style: ChatStyle;

  // 인증
  auth: { currentUser: AuthUser | null; isGuestMode: boolean };

  // actions
  setChatHistory: (fn: (prev: ChatMessage[]) => ChatMessage[]) => void;
  appendMessage: (m: ChatMessage) => void;
  appendToken: (token: string) => void;
  appendThinking: (token: string) => void;
  setStreaming: (v: boolean) => void;
  setCurrentSessionId: (id: string | null) => void;
  setInputDraft: (t: string) => void;
  setActiveAgent: (a: { name: string; emoji?: string } | null) => void;
  setActiveSkills: (s: string[]) => void;
  setActiveUserAgent: (a: { id: string; name: string; icon?: string | null } | null) => void;
  setResearchProgress: (p: ResearchProgressInfo | null) => void;
  setPrivacyPrefs: (patch: { saveHistory?: boolean; memoryLearning?: boolean }) => void;
  /** WS done 시 마지막 assistant 메시지에 서버 messageId 부여 — 피드백 전송용. */
  finalizeLastAssistant: (messageId: string) => void;
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
      | "discussionMode"
      | "deepResearchMode"
      | "webSearchEnabled"
      | "agentTaskMode"
      | "imageMode"
      | "artifactMode"
      | "structuredMode",
  ) => void;
  setSelectedModel: (m: string) => void;
  cycleStyle: () => void;
  setStyle: (m: ChatStyle) => void;
  setAuth: (auth: AppState["auth"]) => void;
}

const STYLE_ORDER: ChatStyle[] = ["default", "concise", "verbose"];

/**
 * primary(전용) 모드 — 상호배타. 하나를 켜면 나머지는 자동으로 꺼진다.
 * 백엔드 message-pipeline 은 primary 모드 "하나"만 실행하고 나머지는 조용히 무시하므로,
 * 동시 활성 시 UI 에는 켜진 것처럼 보이지만 실제로는 안 먹는 착시를 제거하기 위함.
 */
export const PRIMARY_MODE_KEYS = [
  "discussionMode",
  "deepResearchMode",
  "imageMode",
  "agentTaskMode",
  "structuredMode",
] as const;

/**
 * 가로채기(bypass) 모드 — 켜지면 백엔드가 전용 파이프라인을 타며 일반 도구(웹검색·분석)·
 * 아티팩트를 무시한다. 따라서 UI 에서 앰버 신호 + 웹/아티팩트 modifier "(미적용)" 표시에 사용.
 */
export const INTERCEPT_MODE_KEYS = [
  "discussionMode",
  "deepResearchMode",
  "imageMode",
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
  researchProgress: null,

  artifacts: [],
  activeArtifactId: null,
  artifactPanelOpen: false,

  thinkingEnabled: true, // 기본 ON — tool calling 중 추론(thinking) 과정을 화면에 노출
  discussionMode: false,
  deepResearchMode: false,
  webSearchEnabled: false,
  agentTaskMode: false,
  imageMode: false,
  artifactMode: false,
  structuredMode: false,
  mcpToolsEnabled: {},

  saveHistory: true,
  memoryLearning: true,

  selectedModel: "default",
  style: "default",

  auth: { currentUser: null, isGuestMode: true },

  setPrivacyPrefs: (patch) => set(() => ({ ...patch })),
  finalizeLastAssistant: (messageId) =>
    set((s) => {
      const hist = [...s.chatHistory];
      for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i].role === "assistant") {
          hist[i] = { ...hist[i], id: messageId };
          break;
        }
      }
      return { chatHistory: hist };
    }),
  setChatHistory: (fn) => set((s) => ({ chatHistory: fn(s.chatHistory) })),
  appendMessage: (m) => set((s) => ({ chatHistory: [...s.chatHistory, m] })),
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
  setResearchProgress: (p) => set({ researchProgress: p }),
  clearChat: () =>
    set({
      chatHistory: [],
      currentSessionId: null,
      activeAgent: null,
      activeSkills: [],
      researchProgress: null,
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
      // 끄는 경우·비-primary(thinking·web·artifact) 토글은 단순 flip.
      if (next && (PRIMARY_MODE_KEYS as readonly string[]).includes(key)) {
        const cleared: Record<string, boolean> = {};
        for (const k of PRIMARY_MODE_KEYS) {
          if (k !== key) cleared[k] = false;
        }
        cleared[key] = true;
        return cleared as Partial<AppState>;
      }
      return { [key]: next } as Partial<AppState>;
    }),
  setSelectedModel: (m) => set({ selectedModel: m }),
  cycleStyle: () =>
    set((s) => ({
      style: STYLE_ORDER[(STYLE_ORDER.indexOf(s.style) + 1) % STYLE_ORDER.length],
    })),
  setStyle: (m) => set({ style: m }),
  setAuth: (auth) => set({ auth }),
    }),
    {
      name: "openmake-prefs",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : noopStorage,
      ),
      // 사용자 환경설정만 영속화 — 채팅/아티팩트 등 휘발성 세션 상태는 제외
      partialize: (s) => ({ selectedModel: s.selectedModel, style: s.style, activeUserAgent: s.activeUserAgent }),
    },
  ),
);
