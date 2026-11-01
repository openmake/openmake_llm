/**
 * Knowledge Space API 계약 (knowledge-runtime add-on, 2026-09-24) — 웹 `addons/knowledge` ↔ API `/api/knowledge/*`.
 * 응답은 공통 `{ success, data }` 봉투 안의 data 모양이다.
 */

export type KnowledgeScopeType = "user" | "organization";
export type KnowledgeSpaceStatus = "active" | "deleting" | "tombstoned" | "purged";
export type KnowledgeVersionStatus =
  | "uploaded" | "validating" | "extracting" | "chunking" | "embedding" | "verifying" | "ready" | "failed";

/**
 * 공간 임베딩 상태(서버 판정 — 화면은 그린다).
 * ready · unpinned(색인 미고정) · unassigned(임베딩 모델 미배정) · key_missing(색인 모델 공급자 키 없음·비활성)
 * · key_rejected(공급자가 키를 거절) · reindexing(공간 재색인 진행 중)
 */
export type KnowledgeEmbeddingStatus = "ready" | "unpinned" | "unassigned" | "key_missing" | "key_rejected" | "reindexing";

/** 임베딩 색인(벡터 공간) — 모델·차원·거리척도 별 1행, 여러 공간이 공유한다 */
export interface KnowledgeEmbeddingIndexInfo {
  id: string;
  providerRef: string;
  modelId: string;
  dimension: number;
  distanceMetric: string;
}

export interface KnowledgeSpaceEmbedding {
  /** 이 공간의 벡터가 사는 색인 — 아직 고정되지 않았으면 null */
  index: KnowledgeEmbeddingIndexInfo | null;
  status: KnowledgeEmbeddingStatus;
  /** 요청 사용자의 현재 임베딩 설정 — 해석 실패(미배정 등)면 null */
  effective: { providerRef: string; modelId: string; source: "user" | "global" | "default" } | null;
  /** 색인 모델과 현재 설정이 다르다 → "현재 설정 모델로 다시 색인" 안내 */
  mismatch: boolean;
}

export interface KnowledgeSpaceSummary {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  scopeType: KnowledgeScopeType;
  /** Space 소유자가 적은 지침 — 이 Space 에 연결된 대화에 매 턴 주입된다(없으면 null) */
  instructions: string | null;
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
  /** 공간 임베딩 색인·상태(서버 판정) */
  embedding: KnowledgeSpaceEmbedding;
}

export interface KnowledgeDocument {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  status: KnowledgeVersionStatus;
  /** 기계 판독 실패 사유 — FAILED_VALIDATION · SCANNED_PDF_UNSUPPORTED · FAILED_EXTRACTION · FAILED_EMBEDDING · EMBEDDING_KEY_MISSING · EMBEDDING_KEY_REJECTED … */
  failureCode: string | null;
  /** 0–100 */
  progress: number;
  pageCount: number | null;
  createdAt: string;
}

export interface KnowledgeConversation {
  sessionId: string;
  /** 세션 제목이 없으면 null */
  title: string | null;
  /** 세션 갱신 시각(ISO 8601) — Base 컬럼이 NOT NULL 이 아니라 null 일 수 있다 */
  updatedAt: string | null;
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
  instructions?: string;
  scopeType?: KnowledgeScopeType;
}
/** PATCH /api/knowledge/spaces/:id 입력 */
export interface KnowledgeSpaceUpdateInput {
  name?: string;
  description?: string | null;
  icon?: string | null;
  instructions?: string | null;
}

/** Space 메모리(수동 항목) — GET/POST/PATCH /api/knowledge/spaces/:id/memories */
export interface KnowledgeSpaceMemory {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}
/** GET /api/knowledge/spaces/:id/memories */
export interface KnowledgeMemoryListResponse { memories: KnowledgeSpaceMemory[] }
/** POST·PATCH /api/knowledge/spaces/:id/memories[/:memId] 입력 */
export interface KnowledgeMemoryInput { content: string }
/** POST·PATCH /api/knowledge/spaces/:id/memories[/:memId] 응답 */
export interface KnowledgeMemoryResponse { memory: KnowledgeSpaceMemory }

/** POST /api/knowledge/spaces/:id/conversations — 새 대화를 만들고 Space 에 연결한다 */
export interface KnowledgeNewConversationResponse { sessionId: string }
/** GET /api/knowledge/bindings/:sessionId — 대화 상단 배너용(표시일 뿐 권한 근거가 아니다) */
export interface KnowledgeBindingResponse { space: { id: string; name: string; icon: string | null } | null }

/**
 * GET /api/knowledge/capabilities — 사용 가능 여부(pgvector·임베딩·파서). 요청 사용자 기준이다.
 * blockedReasons 코드: PGVECTOR_MISSING · EMBEDDING_UNASSIGNED · EMBEDDING_KEY_MISSING · EMBEDDING_KEY_REJECTED
 * · NO_SUPPORTED_MIME_TYPES · PARSER_REGISTRY_UNAVAILABLE
 */
export interface KnowledgeCapabilities {
  ready: boolean;
  blockedReasons: string[];
  supportedMimeTypes: string[];
  maxFileBytes: number;
  /** 요청 사용자의 실효 임베딩 모델(공급자 호출·차원 측정 없음). dimension 은 같은 모델의 색인이 있을 때만 숫자 */
  embedding: {
    providerRef: string;
    modelId: string;
    source: "user" | "global" | "default";
    status: KnowledgeEmbeddingStatus;
    dimension: number | null;
  } | null;
}

/** POST /api/knowledge/spaces/:id/reindex 202 — 현재 설정 모델로 공간을 다시 색인한다 */
export interface KnowledgeSpaceReindexResponse { jobId: string; indexId: string }

/** POST·PATCH /api/knowledge/spaces[/:id] 응답 */
export interface KnowledgeSpaceResponse { space: KnowledgeSpaceSummary }
/** GET /api/knowledge/spaces/:id 응답 */
export interface KnowledgeSpaceDetailResponse { space: KnowledgeSpaceDetail }
/** POST /api/knowledge/spaces/:id/documents 응답 (중복 원본은 409 DUPLICATE_DOCUMENT) */
export interface KnowledgeDocumentResponse { document: KnowledgeDocument }

/** GET /api/knowledge/spaces/:id/chunks/:chunkId — 인용 미리보기 */
export interface KnowledgeChunkPreview {
  documentId: string;
  documentName: string;
  pageStart: number | null;
  pageEnd: number | null;
  content: string;
}

/** GET /api/knowledge/admin/status (관리자) */
export interface KnowledgeAdminStatus {
  capabilities: KnowledgeCapabilities;
  /** 색인 카탈로그 — 모델·차원·상태와 그 색인을 쓰는 공간 수 */
  embeddingIndexes: Array<KnowledgeEmbeddingIndexInfo & { status: string; spaceCount: number; createdAt: string }>;
  /** 수집 작업 상태별 건수 */
  jobCounts: Record<string, number>;
  pgvectorVersion: string | null;
}

/** 정책 프로필 — 청크·검색·한도 설정 데이터 (GET /admin/profiles → { profiles }, PUT /admin/profiles/:id → { profile }) */
export interface KnowledgeProfile {
  id: string;
  kind: "space" | "chunker" | "retrieval" | "limits";
  name: string;
  config: Record<string, unknown>;
  isDefault: boolean;
  updatedAt: string;
}

/** PUT /api/knowledge/admin/profiles/:id 입력 — config 는 반드시 이 키로 감싼다 */
export interface KnowledgeProfileUpdateInput {
  name?: string;
  config: Record<string, unknown>;
}
