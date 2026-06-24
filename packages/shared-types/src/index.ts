/**
 * @openmake/shared-types — 프론트(apps/web) ↔ 백엔드(apps/api) 공통 타입 계약.
 *
 * 백엔드 응답 래퍼(api-response)와 핵심 도메인 모델을 한 곳에서 정의해
 * 프론트/백엔드가 동일 타입을 import 하도록 한다. (API 계약을 코드로 강제)
 *
 * 외부 분리 서버는 이 타입 계약 밖에 있다(설계 유지):
 *   - LLM 추론/임베딩 → 외부 vLLM/LiteLLM (OpenAI 호환 API)
 *   - DB → docker 분리 운영
 */

/* ── API 응답 래퍼 (backend utils/api-response 와 1:1) ───────────────── */
export interface ApiMeta {
  timestamp: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
  meta: ApiMeta;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/* ── 도메인 모델 ─────────────────────────────────────────────────────── */
export type UserRole = "admin" | "user" | "guest";

export interface User {
  id: string;
  email: string;
  username?: string;
  role: UserRole;
  is_active?: boolean;
  created_at?: string;
  last_login?: string;
}

export interface ConversationSession {
  id: string;
  title?: string;
  user_id?: string | null;
  model?: string;
  messageCount?: number;
  created_at?: string;
  updated_at?: string;
}

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  model?: string;
  tokens?: number;
  images?: string[];
  created_at?: string;
}

/* ── WebSocket 채팅 프로토콜 (sockets/ws-chat-handler 와 페어) ───────── */
/** 첨부 텍스트 파일 (백엔드 ws-chat-handler files[] · attach-context AttachedFileInput 호환) */
export interface WsAttachedFile {
  id: string;
  name: string;
  type: string;
  /** 텍스트 내용 (바이너리는 미전송). 클라이언트가 캡 초과 시 절단 */
  content?: string;
  /** 추출 대상 바이너리 문서(PDF/docx/xlsx/pptx 등)의 base64 원본. 백엔드가 텍스트로 추출해 content 를 채운다 */
  data?: string;
  size?: number;
  /** 전송 전 캡으로 내용을 절단했음 */
  truncated?: boolean;
}

export interface WsChatRequest {
  type: "chat";
  message: string;
  model?: string;
  history?: Array<{ role: ChatRole; content: string }>;
  sessionId?: string | null;
  images?: string[];
  /** 첨부 텍스트 파일 — 백엔드가 fileContext 채널로 LLM 에 주입 */
  files?: WsAttachedFile[];
  webSearch?: boolean;
  deepResearchMode?: boolean;
  /** 멀티 에이전트 토론 모드 */
  discussionMode?: boolean;
  /** Sequential Thinking 모드 (UI thinkingEnabled 토글) */
  thinkingMode?: boolean;
  /** 이미지 생성 모드 — ON 이면 메시지를 프롬프트로 이미지를 직접 생성 */
  imageMode?: boolean;
  /** 아티팩트 모드 — ON 이면 모델이 <artifact> 산출물을 생성하도록 유도 */
  artifactMode?: boolean;
  enabledTools?: Record<string, boolean>;
}

/** 아티팩트 메타 — 백엔드 llm/artifact-parser.ts ArtifactInfo 와 동일 계약. */
export interface ArtifactMeta {
  id: string;
  kind: string;
  title: string;
  lang: string | null;
}

export type WsServerEvent =
  | { type: "token"; token: string }
  | { type: "session_created"; sessionId: string }
  | { type: "done"; sessionId?: string; totalTokens?: number }
  | { type: "aborted"; message?: string }
  | { type: "error"; message: string }
  | { type: "init"; data?: unknown }
  | {
      type: "agent_selected";
      agent: {
        type: string;
        name: string;
        emoji?: string;
        phase?: string;
        reason?: string;
        confidence?: number;
      };
    }
  | { type: "skills_activated"; skillNames: string[] }
  // 아티팩트 스트리밍 (백엔드 ws-chat-handler.ts 송출)
  | { type: "artifact_start"; artifact: ArtifactMeta; messageId?: string }
  | { type: "artifact_chunk"; id: string; delta: string; messageId?: string }
  | { type: "artifact_end"; id: string; messageId?: string }
  // 에이전트 작업 진행상황 (백엔드 sockets/handler.ts agent_task_progress relay)
  | {
      type: "agent_task_progress";
      taskId: string;
      status: string;
      progress: number;
      currentTurn: number;
    };

/* ── 응답 페이로드 헬퍼 타입 ─────────────────────────────────────────── */
export interface SessionsPayload {
  sessions: ConversationSession[];
}
export interface MePayload {
  user: User;
}
