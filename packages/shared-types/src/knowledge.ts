/**
 * Knowledge Space API 계약 (knowledge-runtime add-on, 2026-09-24) — 웹 `addons/knowledge` ↔ API `/api/knowledge/*`.
 * 응답은 공통 `{ success, data }` 봉투 안의 data 모양이다.
 */

export type KnowledgeScopeType = "user" | "organization";
export type KnowledgeSpaceStatus = "active" | "deleting" | "tombstoned" | "purged";
export type KnowledgeVersionStatus =
  | "uploaded" | "validating" | "extracting" | "chunking" | "embedding" | "verifying" | "ready" | "failed";

export interface KnowledgeSpaceSummary {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  scopeType: KnowledgeScopeType;
  /** 현재 사용자가 이름·자료·삭제를 바꿀 수 있는가 (서버 판정) */
  canEdit: boolean;
  documentCount: number;
  conversationCount: number;
  /** 처리 중(uploaded~verifying) 문서 수 */
  processingCount: number;
  /** 실패 문서 수 */
  failedCount: number;
  lastUsedAt: string | null;
  updatedAt: string;
}

export interface KnowledgeDocument {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  status: KnowledgeVersionStatus;
  /** 기계 판독 실패 사유 — FAILED_VALIDATION · SCANNED_PDF_UNSUPPORTED · FAILED_EXTRACTION · FAILED_EMBEDDING … */
  failureCode: string | null;
  /** 0–100 */
  progress: number;
  pageCount: number | null;
  createdAt: string;
}

export interface KnowledgeConversation {
  sessionId: string;
  title: string;
  updatedAt: string;
}

export interface KnowledgeSpaceDetail extends KnowledgeSpaceSummary {
  documents: KnowledgeDocument[];
  conversations: KnowledgeConversation[];
}

/** GET /api/knowledge/spaces */
export interface KnowledgeSpaceListResponse { spaces: KnowledgeSpaceSummary[] }
/** POST /api/knowledge/spaces 입력 — scope 생략 시 개인, organization 은 활성 조직만 */
export interface KnowledgeSpaceCreateInput {
  name: string;
  description?: string;
  icon?: string;
  scopeType?: KnowledgeScopeType;
}
/** PATCH /api/knowledge/spaces/:id 입력 */
export interface KnowledgeSpaceUpdateInput { name?: string; description?: string | null; icon?: string | null }

/** POST /api/knowledge/spaces/:id/conversations — 새 대화를 만들고 Space 에 연결한다 */
export interface KnowledgeNewConversationResponse { sessionId: string }
/** GET /api/knowledge/bindings/:sessionId — 대화 상단 배너용(표시일 뿐 권한 근거가 아니다) */
export interface KnowledgeBindingResponse { space: { id: string; name: string; icon: string | null } | null }

/** GET /api/knowledge/capabilities — 사용 가능 여부(pgvector·임베딩 provider·파서) */
export interface KnowledgeCapabilities {
  ready: boolean;
  blockedReasons: string[];
  supportedMimeTypes: string[];
  maxFileBytes: number;
  embedding: { providerRef: string; modelId: string; dimension: number } | null;
}
