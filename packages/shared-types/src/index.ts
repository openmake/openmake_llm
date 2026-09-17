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
  /** 클라이언트 발급 멱등 키(140) — 같은 id 재전송은 새 생성 없이 이전 messageId 로 done 만 다시 온다 */
  clientRequestId?: string;
  model?: string;
  history?: Array<{ role: ChatRole; content: string }>;
  sessionId?: string | null;
  /** Browser-scoped anonymous owner id for guest sessions. */
  anonSessionId?: string;
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
  /** 응답 스타일 — 백엔드 chat/style.ts 가 system prompt 앞에 style guard 를 prepend (concise=간결, verbose=상세) */
  style?: "concise" | "default" | "verbose";
  enabledTools?: Record<string, boolean>;
  /** NotebookLM 노트북 컨텍스트 — composer picker 선택. 백엔드(ws-chat-handler)가 grounding 프리픽스를 주입 */
  notebook?: { id: string; title: string } | null;
  /** 개인정보: false 면 백엔드가 대화 기록 저장을 생략 (설정 페이지 토글). 기본 true */
  saveHistory?: boolean;
  /** 개인정보: false 면 메모리 학습 비활성 (saveHistory 와 독립). 기본 true */
  memoryLearning?: boolean;
  /** 커스텀 에이전트(user_agents) id — 지정 시 백엔드가 산업 에이전트 자동라우팅을 우회하고 해당 페르소나 system_prompt 를 prepend */
  userAgentId?: string;
  /**
   * 기기 GPS 현재 위치 (폰 기능 2단계, 옵트인) — 클라이언트가 위치 관련 턴에만 첨부.
   * 서버는 system 컨텍스트에 결정적 주입해 카카오 search-places(x=lng, y=lat) 좌표 검색을
   * 가능하게 한다. 저장하지 않는 턴 단위 값.
   */
  userLocation?: { lat: number; lng: number };
  /**
   * 클라이언트 표면 — 좁은 화면(모바일 네이티브)에 맞는 답변 형식을 요청할 때 'ios'.
   * 미지정은 기존 동작(데스크톱 기준). 서버는 이 값으로 answer-format 에 화면 폭
   * 지시를 덧붙일 뿐, 내용/기능 분기는 하지 않는다.
   */
  client?: "ios";
  /** 비교 모드(두 모델 동시 답변) 패널 식별자. 같은 사용자의 스트림 키에 접미사로 붙어 레인별로 독립 스트림을 가진다. 형식 `^[a-z0-9_-]{1,16}$`, 그 외는 무시(레인 없음). (2026-09-09) */
  lane?: string;
}

/** 아티팩트 메타 — 백엔드 llm/artifact-parser.ts ArtifactInfo 와 동일 계약. */
export interface ArtifactMeta {
  id: string;
  kind: string;
  title: string;
  lang: string | null;
}

/** MCP 도구 결과의 resource content (백엔드 external-tool-exec 가 추출해 emit). */
export interface McpToolResource {
  uri: string;
  mimeType?: string;
  text?: string;
}

/**
 * 스트림 이벤트 공통 봉투(F19.11, 2026-09-17) — 채팅 스트림 이벤트에 서버가 덧붙이는 이어받기 커서.
 * `streamId` 는 스트림(한 번의 생성)마다 새로 발급되고 `seq` 는 그 안에서 1부터 단조 증가한다(토큰 포함).
 * 클라이언트는 마지막으로 받은 값을 기억해 재연결 시 `resume{streamId, afterSeq}` 로 보내고,
 * `seq <= afterSeq` 인 이벤트는 중복이므로 무시한다. 구 서버는 필드가 없다.
 */
export interface WsStreamEnvelope {
  streamId?: string;
  seq?: number;
}

/** 재연결 후 끊긴 스트림 이어받기 요청 — 커서가 없거나 다른 스트림이면 서버는 미전달 이벤트만 재생한다(종전 동작). */
export interface WsResumeRequest {
  type: "resume";
  /** 게스트 스트림 키 */
  anonSessionId?: string;
  /** 비교 모드 레인 */
  lane?: string;
  /** 마지막으로 받은 이벤트의 streamId */
  streamId?: string;
  /** 마지막으로 받은 이벤트의 seq — 같은 스트림이면 이 뒤 이벤트만 재생 */
  afterSeq?: number;
}

export type WsServerEvent =
  | { type: "token"; token: string }
  | { type: "thinking"; token: string; messageId?: string }
  | { type: "thinking_summary"; summary: string; messageId?: string }
  /** 답변 검증 지적 — done 이후 judge 모델 1회 점검 결과. 지적이 없으면 이 이벤트는 오지 않는다. */
  | { type: "answer_verification"; issues: string; messageId?: string }
  | { type: "session_created"; sessionId: string }
  /** 연결 직후 서버 build id — 클라가 기억해 두고 다른 build 재수신 시 배포로 간주(reload). */
  | { type: "build_id"; buildId: string }
  /**
   * 인증 토큰 만료 임박 경고(쿨다운 있음). 웹은 HttpOnly 쿠키라 토큰을 못 읽으므로
   * REST refresh(쿠키 회전) 후 WS 재연결(새 핸드셰이크)로 갱신한다.
   */
  | { type: "token_warning"; message: string }
  /** 오류 시 디버그 본문 24h 임시 보관 고지(saveHistory=false 여도 재현용). */
  | { type: "debug_retained"; captureId: string; expiresAt: string; ttlHours: number }
  /**
   * 백엔드 메타 알림 (ws-chat-handler onSystemEvent).
   * 현재 소비: 'model_fallback' — 선택 모델 실패로 다른 모델이 답했음을 고지.
   */
  | {
      type: "system_event";
      payload: { type: string; message: string; metadata?: Record<string, unknown> };
    }
  | {
      type: "done";
      messageId?: string;
      /** 백엔드 실제 페이로드(ws-chat-handler): 스트리밍 완료 시 토큰 메트릭. tokensPerSec 는 toFixed(2) 문자열. */
      metrics?: { tokensPerSec: string; tokenCount: number };
      /** 아티팩트가 있으면 raw 코드펜스가 placeholder 로 치환된 본문 — 클라가 누적 본문을 이걸로 reset. */
      cleanedContent?: string;
      /** 같은 clientRequestId 의 재전송이라 새 생성 없이 끝냈음(140) */
      deduplicated?: boolean;
    }
  | { type: "aborted"; message?: string }
  /**
   * 끊겼던 스트림 이어받기 (2026-09-05). 클라이언트가 재연결 후 `{type:"resume", anonSessionId?}` 를
   * 보내면 서버가 진행 중(또는 방금 끝난) 스트림의 본문 스냅샷을 주고 이어서 스트리밍한다.
   * content 는 지금까지의 답변 전체 — 클라는 마지막 assistant 본문을 이 값으로 되돌린 뒤 후속
   * token 을 이어 붙인다. finished=true 면 뒤따르는 done/error 로 곧 끝난다.
   */
  | {
      type: "stream_resume";
      messageId?: string;
      sessionId?: string;
      content: string;
      thinking?: string;
      finished: boolean;
      /** 이 스트림의 식별자(F19.11) — 클라이언트 커서가 다르면 새 스트림으로 본다 */
      streamId?: string;
      /** 스냅샷이 반영한 마지막 순번 */
      lastSeq?: number;
      /** 재생해야 할 이벤트 일부가 링버퍼에서 밀려났음 — 아티팩트는 done.cleanedContent 로 재구성할 것 */
      gap?: boolean;
    }
  /** resume 요청에 이어받을 스트림이 없음 — 클라는 대기 상태를 풀면 된다. */
  | { type: "resume_none" }
  | {
      type: "error";
      message: string;
      /** 에러 분류(quota_exceeded / api_keys_exhausted / provider code 등) */
      errorType?: string;
      /** 재시도 가능까지 남은 초(quota/키 소진). */
      retryAfter?: number;
      /** 키 쿨다운 해제 시각(ISO) — api_keys_exhausted. */
      resetTime?: string;
      totalKeys?: number;
      keysInCooldown?: number;
    }
  | { type: "init"; data?: unknown }
  | {
      type: "agent_selected";
      agent: {
        type: string;
        name: string;
        /** 영어 표시 이름 — 한국어 외 UI 는 이것을 쓴다(산업·범용 에이전트만, 커스텀 에이전트는 없음) */
        nameEn?: string;
        emoji?: string;
        phase?: string;
        reason?: string;
        confidence?: number;
      };
    }
  | {
      type: "skills_activated";
      skillNames: string[];
      /** 시스템 시드 스킬의 영어 표시 이름(스킬 이름 → 영어) — 사용자·확장 스킬은 없다 */
      skillNamesEn?: Record<string, string>;
    }
  // MCP 도구 호출 진행 (백엔드 ws-chat-handler onMcpToolStart/onMcpToolResult)
  | { type: "mcp_tool_start"; toolName: string; messageId?: string }
  | { type: "mcp_tool_result"; toolName: string; resources?: McpToolResource[]; messageId?: string }
  // 토론 모드 진행 (백엔드 ws-chat-handler onDiscussionProgress → DiscussionProgress)
  | {
      type: "discussion_progress";
      progress: {
        phase: "selecting" | "discussing" | "reviewing" | "synthesizing" | "complete";
        currentAgent?: string;
        agentEmoji?: string;
        message: string;
        progress: number;
        roundNumber?: number;
        totalRounds?: number;
      };
    }
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
      /** 방금 기록된 스텝 요약(4-5 실시간 스트림) — "현재 단계" 라이브 표시용. */
      step?: { stepType: string; toolName?: string; preview?: string };
    }
  // 딥리서치 진행상황 (백엔드 ws-chat-handler onResearchProgress)
  | {
      type: "research_progress";
      progress: {
        sessionId?: string;
        status?: string;
        currentLoop?: number;
        totalLoops?: number;
        currentStep?: string;
        progress?: number;
        message?: string;
      };
    };

/* ── 응답 페이로드 헬퍼 타입 ─────────────────────────────────────────── */
export interface SessionsPayload {
  sessions: ConversationSession[];
}
/** 조직 역할 (127) */
export type OrgRole = "owner" | "admin" | "member";

/** 사용자 관점 조직 멤버십 — GET /api/users/me/organizations (F22 Phase A) */
export interface OrgMembership {
  orgId: string;
  name: string;
  slug: string;
  role: OrgRole;
  monthlyTokenBudget: number | null;
}

/** 활성 조직 컨텍스트 — /api/auth/me 의 activeOrganization (null = 개인) */
export interface ActiveOrganization {
  orgId: string;
  orgRole: OrgRole;
}

export interface MePayload {
  user: User;
  /** F22 Phase A: 활성 조직(없으면 null). 구 서버는 필드 자체가 없다. */
  activeOrganization?: ActiveOrganization | null;
}
