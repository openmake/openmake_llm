import { create } from "zustand";
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
}

export type { ChatRole };

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

  // 모드 토글 (기존 state.js)
  thinkingEnabled: boolean;
  discussionMode: boolean;
  deepResearchMode: boolean;
  webSearchEnabled: boolean;
  agentTaskMode: boolean;
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
  setStreaming: (v: boolean) => void;
  setCurrentSessionId: (id: string | null) => void;
  setInputDraft: (t: string) => void;
  clearChat: () => void;

  toggle: (
    key:
      | "thinkingEnabled"
      | "discussionMode"
      | "deepResearchMode"
      | "webSearchEnabled"
      | "agentTaskMode",
  ) => void;
  setSelectedModel: (m: string) => void;
  cycleStyle: () => void;
  setAuth: (auth: AppState["auth"]) => void;
}

const STYLE_ORDER: ChatStyle[] = ["default", "concise", "verbose"];

export const useAppStore = create<AppState>((set) => ({
  chatHistory: [],
  currentSessionId: null,
  isGenerating: false,
  inputDraft: "",

  thinkingEnabled: true,
  discussionMode: false,
  deepResearchMode: false,
  webSearchEnabled: false,
  agentTaskMode: false,
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
  clearChat: () => set({ chatHistory: [], currentSessionId: null }),

  toggle: (key) => set((s) => ({ [key]: !s[key] }) as Partial<AppState>),
  setSelectedModel: (m) => set({ selectedModel: m }),
  cycleStyle: () =>
    set((s) => ({
      style: STYLE_ORDER[(STYLE_ORDER.indexOf(s.style) + 1) % STYLE_ORDER.length],
    })),
  setAuth: (auth) => set({ auth }),
}));
