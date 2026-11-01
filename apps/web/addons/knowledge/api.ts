/**
 * Knowledge add-on(웹) API 래퍼 — 전부 /api/knowledge/* 를 `{success,data}` 봉투로 읽는다.
 * 모든 요청은 ApiClient — 멀티파트 업로드도 FormData 를 그대로 넘긴다(ApiClient 가 JSON 직렬화하지 않는다)
 */
import { ApiClient, ApiError } from "@/lib/api-client";
import type {
  KnowledgeAdminStatus,
  KnowledgeBindingResponse,
  KnowledgeChunkPreview,
  KnowledgeProfile,
  KnowledgeProfileUpdateInput,
  KnowledgeCapabilities,
  KnowledgeConversation,
  KnowledgeDocument,
  KnowledgeSpaceCreateInput,
  KnowledgeSpaceDetail,
  KnowledgeSpaceMemory,
  KnowledgeSpaceReindexResponse,
  KnowledgeSpaceSummary,
  KnowledgeSpaceUpdateInput,
} from "@openmake/shared-types";

export type { KnowledgeAdminStatus, KnowledgeChunkPreview, KnowledgeProfile };

type Envelope<T> = { success: boolean; data: T };

/** 서버 오류 코드(DUPLICATE_DOCUMENT·EMBEDDING_KEY_MISSING·REINDEX_NOT_NEEDED …)를 status·code 로 올려 던진다 — 호출부가 코드로 안내를 고른다 */
async function withCode<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (e instanceof ApiError) {
      const code = (e.body as { error?: { code?: string } } | undefined)?.error?.code;
      throw Object.assign(new Error(e.message), { status: e.status, code });
    }
    throw e;
  }
}

/** 서버가 바인딩에 쓰는 최근 대화(공용 /api/chat/conversations) */
export interface RecentChat {
  sessionId: string;
  title: string;
  updatedAt?: string;
}

const base = "/api/knowledge";

export const knowledgeApi = {
  capabilities: () =>
    ApiClient.get<Envelope<KnowledgeCapabilities>>(`${base}/capabilities`).then((r) => r.data),

  listSpaces: () =>
    ApiClient.get<Envelope<{ spaces: KnowledgeSpaceSummary[] }>>(`${base}/spaces`).then(
      (r) => r.data.spaces,
    ),

  /** 412(임베딩 미배정·키)·502(차원 측정 실패)는 status·code 를 단 Error 로 던진다 */
  createSpace: (input: KnowledgeSpaceCreateInput) =>
    withCode(() => ApiClient.post<Envelope<{ space: KnowledgeSpaceSummary }>>(`${base}/spaces`, input)).then(
      (r) => r.data.space,
    ),

  getSpace: (id: string) =>
    ApiClient.get<Envelope<{ space: KnowledgeSpaceDetail }>>(`${base}/spaces/${id}`).then(
      (r) => r.data.space,
    ),

  updateSpace: (id: string, input: KnowledgeSpaceUpdateInput) =>
    ApiClient.patch<Envelope<{ space: KnowledgeSpaceSummary }>>(`${base}/spaces/${id}`, input).then(
      (r) => r.data.space,
    ),

  deleteSpace: (id: string) => ApiClient.del<Envelope<unknown>>(`${base}/spaces/${id}`),

  /** 멀티파트 업로드 — 409(DUPLICATE_DOCUMENT)·412(임베딩 키) 는 status·code 를 단 Error 로 던진다(호출부가 분기). */
  uploadDocument: async (id: string, file: File): Promise<KnowledgeDocument> => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await withCode(() => ApiClient.post<Envelope<{ document: KnowledgeDocument }>>(`${base}/spaces/${id}/documents`, fd));
    return r.data.document;
  },

  deleteDocument: (id: string, docId: string) =>
    ApiClient.del<Envelope<unknown>>(`${base}/spaces/${id}/documents/${docId}`),

  retryDocument: (id: string, docId: string) =>
    withCode(() => ApiClient.post<Envelope<unknown>>(`${base}/spaces/${id}/documents/${docId}/retry`)),

  /** 현재 설정 모델로 다시 색인 — 202 { jobId, indexId }, 409·412·502 는 status·code 를 단 Error */
  reindexSpace: (id: string) =>
    withCode(() => ApiClient.post<Envelope<KnowledgeSpaceReindexResponse>>(`${base}/spaces/${id}/reindex`)).then((r) => r.data),

  newConversation: (id: string) =>
    ApiClient.post<Envelope<{ sessionId: string }>>(`${base}/spaces/${id}/conversations`).then(
      (r) => r.data.sessionId,
    ),

  bindConversation: (id: string, sessionId: string) =>
    ApiClient.put<Envelope<unknown>>(`${base}/spaces/${id}/conversations/${sessionId}`),

  unbindConversation: (id: string, sessionId: string) =>
    ApiClient.del<Envelope<unknown>>(`${base}/spaces/${id}/conversations/${sessionId}`),

  getBinding: (sessionId: string) =>
    ApiClient.get<Envelope<KnowledgeBindingResponse>>(`${base}/bindings/${sessionId}`).then(
      (r) => r.data,
    ),

  // ── 프로젝트 메모리(수동) ────────────────────────────────
  listMemories: (id: string) =>
    ApiClient.get<Envelope<{ memories: KnowledgeSpaceMemory[] }>>(`${base}/spaces/${id}/memories`).then(
      (r) => r.data.memories,
    ),

  addMemory: (id: string, content: string) =>
    ApiClient.post<Envelope<{ memory: KnowledgeSpaceMemory }>>(`${base}/spaces/${id}/memories`, { content }).then(
      (r) => r.data.memory,
    ),

  updateMemory: (id: string, memId: string, content: string) =>
    ApiClient.patch<Envelope<{ memory: KnowledgeSpaceMemory }>>(`${base}/spaces/${id}/memories/${memId}`, { content }).then(
      (r) => r.data.memory,
    ),

  deleteMemory: (id: string, memId: string) =>
    ApiClient.del<Envelope<unknown>>(`${base}/spaces/${id}/memories/${memId}`),

  getChunk: (id: string, chunkId: string) =>
    ApiClient.get<Envelope<KnowledgeChunkPreview>>(`${base}/spaces/${id}/chunks/${chunkId}`).then(
      (r) => r.data,
    ),

  // ── 관리자 ──────────────────────────────────────────────
  adminStatus: () =>
    ApiClient.get<Envelope<KnowledgeAdminStatus>>(`${base}/admin/status`).then((r) => r.data),

  adminProfiles: () =>
    ApiClient.get<Envelope<{ profiles: KnowledgeProfile[] }>>(`${base}/admin/profiles`).then(
      (r) => r.data.profiles,
    ),

  adminUpdateProfile: (profileId: string, config: Record<string, unknown>) => {
    // 서버 스키마는 { config } 봉투를 요구한다 — config 를 맨몸으로 보내면 400(2026-09-24 코드 리뷰)
    const body: KnowledgeProfileUpdateInput = { config };
    return ApiClient.put<Envelope<{ profile: KnowledgeProfile }>>(`${base}/admin/profiles/${profileId}`, body);
  },

  adminRechunk: (spaceId: string) =>
    ApiClient.post<Envelope<unknown>>(`${base}/admin/spaces/${spaceId}/rechunk`),
};

export type { KnowledgeConversation, KnowledgeSpaceMemory };
