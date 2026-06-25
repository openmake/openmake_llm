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
  /** 스트리밍 진행 중 여부 (assistant 메시지) */
  streaming?: boolean;
  /** 에이전트 작업 메시지 — agent_task_progress 로 라이브 업데이트되는 메시지 식별자 */
  taskId?: string;
  /** 추론(thinking) 내용 — ws thinking 이벤트로 누적, 화면에 접이식 블록으로 표시 */
  reasoning?: string;
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
  mcpToolsEnabled: Record<string, boolean>;

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
  clearChat: () => void;

  // 아티팩트 actions
  startArtifact: (meta: Omit<Artifact, "content" | "streaming">) => void;
  appendArtifactDelta: (id: string, delta: string) => void;
  endArtifact: (id: string) => void;
  setActiveArtifact: (id: string | null) => void;
  setArtifactPanelOpen: (v: boolean) => void;
  setArtifacts: (list: Artifact[]) => void;

  toggle: (
    key:
      | "thinkingEnabled"
      | "discussionMode"
      | "deepResearchMode"
      | "webSearchEnabled"
      | "agentTaskMode"
      | "imageMode"
      | "artifactMode",
  ) => void;
  setSelectedModel: (m: string) => void;
  cycleStyle: () => void;
  setStyle: (m: ChatStyle) => void;
  setAuth: (auth: AppState["auth"]) => void;
}

const STYLE_ORDER: ChatStyle[] = ["default", "concise", "verbose"];

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
  mcpToolsEnabled: {},

  selectedModel: "default",
  style: "default",

  auth: { currentUser: null, isGuestMode: true },

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
  clearChat: () =>
    set({
      chatHistory: [],
      currentSessionId: null,
      activeAgent: null,
      activeSkills: [],
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

  toggle: (key) => set((s) => ({ [key]: !s[key] }) as Partial<AppState>),
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
      partialize: (s) => ({ selectedModel: s.selectedModel, style: s.style }),
    },
  ),
);
