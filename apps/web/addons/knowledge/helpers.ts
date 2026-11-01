/**
 * Knowledge add-on(웹) 순수 헬퍼 — 상태·실패코드 → i18n 키 매핑, 크기 표시. 부수효과 없음.
 * 컴포넌트는 useTranslations("knowledge") 로 받은 t 에 이 키를 넣어 문자열을 만든다.
 */
import type { KnowledgeEmbeddingStatus, KnowledgeSpaceSummary, KnowledgeVersionStatus } from "@openmake/shared-types";

/** 처리 중(uploaded~verifying)으로 볼 상태 — 이 상태가 하나라도 있으면 상세가 폴링한다. */
const PROCESSING_STATUSES: ReadonlySet<KnowledgeVersionStatus> = new Set([
  "uploaded",
  "validating",
  "extracting",
  "chunking",
  "embedding",
  "verifying",
]);

export function isProcessing(status: KnowledgeVersionStatus): boolean {
  return PROCESSING_STATUSES.has(status);
}

/** 상태 라벨 i18n 키(`status.<key>`). 미지의 값은 원문을 그대로 쓰도록 null 을 준다. */
export function statusLabelKey(status: KnowledgeVersionStatus): string {
  return `status.${status}`;
}

/** 실패코드 → i18n 키(`failure.<key>`) 룩업. 미등록 코드는 `failure.unknown`. */
const FAILURE_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  FAILED_VALIDATION: "failure.validation",
  SCANNED_PDF_UNSUPPORTED: "failure.scannedPdf",
  FAILED_EXTRACTION: "failure.extraction",
  FAILED_EMBEDDING: "failure.embedding",
  FAILED_VERIFICATION: "failure.verification",
  EMBEDDING_KEY_MISSING: "failure.embeddingKeyMissing",
  EMBEDDING_KEY_REJECTED: "failure.embeddingKeyRejected",
  CANCELLED: "failure.cancelled",
  ADDON_NOT_ENTITLED: "failure.notEntitled",
};

export function failureMessageKey(code: string | null | undefined): string {
  return code && Object.hasOwn(FAILURE_MESSAGE_KEYS, code) ? FAILURE_MESSAGE_KEYS[code] : "failure.unknown";
}

/** 공간 임베딩 상태(서버 판정) → i18n 키(`embedding.status.<status>`) */
export function embeddingStatusKey(status: KnowledgeEmbeddingStatus): string {
  return `embedding.status.${status}`;
}

/** 실패코드 중 임베딩 키 문제 — 문서 목록이 "설정 열기" 링크를 함께 보인다 */
const EMBEDDING_KEY_FAILURES: ReadonlySet<string> = new Set(["EMBEDDING_KEY_MISSING", "EMBEDDING_KEY_REJECTED"]);

export function isEmbeddingKeyFailure(code: string | null | undefined): boolean {
  return !!code && EMBEDDING_KEY_FAILURES.has(code);
}

/** 서버 오류 코드(업로드·재시도·재색인·생성의 412/409/502) → 안내 i18n 키. 미등록 코드는 null(서버 메시지를 그대로 보인다) */
const EMBEDDING_ERROR_KEYS: Readonly<Record<string, string>> = {
  EMBEDDING_KEY_MISSING: "embedding.error.keyMissing",
  EMBEDDING_KEY_REJECTED: "embedding.error.keyRejected",
  EMBEDDING_UNASSIGNED: "embedding.error.unassigned",
  EMBEDDING_PROVIDER_UNAVAILABLE: "embedding.error.providerUnavailable",
  REINDEX_NOT_NEEDED: "embedding.error.reindexNotNeeded",
  REINDEX_IN_PROGRESS: "embedding.error.reindexInProgress",
};

export function embeddingErrorKey(code: string | null | undefined): string | null {
  return code && Object.hasOwn(EMBEDDING_ERROR_KEYS, code) ? EMBEDDING_ERROR_KEYS[code] : null;
}

/** 설정 화면으로 이끌 오류 코드(키·배정 문제) */
const SETTINGS_ERROR_CODES: ReadonlySet<string> = new Set(["EMBEDDING_KEY_MISSING", "EMBEDDING_KEY_REJECTED", "EMBEDDING_UNASSIGNED"]);

export function needsEmbeddingSettings(code: string | null | undefined): boolean {
  return !!code && SETTINGS_ERROR_CODES.has(code);
}

/** "현재 설정 모델로 다시 색인" 을 보일 상태 — 서버가 준 status·mismatch 로만 고른다 */
const REINDEX_OFFER_STATUSES: ReadonlySet<KnowledgeEmbeddingStatus> = new Set(["key_missing", "key_rejected", "unpinned"]);

export function canOfferReindex(space: Pick<KnowledgeSpaceSummary, "canEdit" | "embedding">): boolean {
  const e = space.embedding;
  if (!space.canEdit || e.status === "reindexing" || !e.effective) return false;
  return e.mismatch || REINDEX_OFFER_STATUSES.has(e.status);
}

/** capabilities.blockedReasons 코드 → i18n 키(`blocked.<code>`). 미등록 코드는 null(원문을 보인다) */
const BLOCKED_REASON_CODES: ReadonlySet<string> = new Set([
  "PGVECTOR_MISSING",
  "EMBEDDING_UNASSIGNED",
  "EMBEDDING_KEY_MISSING",
  "EMBEDDING_KEY_REJECTED",
  "EMBEDDING_PROVIDER_UNAVAILABLE",
  "NO_SUPPORTED_MIME_TYPES",
  "PARSER_REGISTRY_UNAVAILABLE",
]);

export function blockedReasonKey(code: string): string | null {
  return BLOCKED_REASON_CODES.has(code) ? `blocked.${code}` : null;
}

/** 요청 사용자의 임베딩 설정·키에 따른 사유 — 공간 상태(embedding 절)와 같은 기준이라 플랫폼 준비 여부와 따로 보인다 */
const EMBEDDING_BLOCKED_REASONS: ReadonlySet<string> = new Set([
  "EMBEDDING_UNASSIGNED",
  "EMBEDDING_KEY_MISSING",
  "EMBEDDING_KEY_REJECTED",
  "EMBEDDING_PROVIDER_UNAVAILABLE",
]);

/** capabilities.blockedReasons → 플랫폼(전 사용자 공통, 모르는 코드 포함)·요청 사용자 임베딩 사유 */
export function splitBlockedReasons(reasons: readonly string[]): { platform: string[]; embedding: string[] } {
  return {
    platform: reasons.filter((r) => !EMBEDDING_BLOCKED_REASONS.has(r)),
    embedding: reasons.filter((r) => EMBEDDING_BLOCKED_REASONS.has(r)),
  };
}

/** 색인 카탈로그 상태 값 → i18n 키(`admin.indexStatusValue.<status>`). 미등록 값은 null(원문을 보인다) */
const INDEX_STATUS_VALUES: ReadonlySet<string> = new Set(["ready", "retired", "building"]);

export function indexStatusKey(status: string): string | null {
  return INDEX_STATUS_VALUES.has(status) ? `admin.indexStatusValue.${status}` : null;
}

const KB = 1024;
const UNITS = ["B", "KB", "MB", "GB"] as const;

/** 사람이 읽는 바이트 표기(소수 1자리). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let i = 0;
  let n = bytes;
  while (n >= KB && i < UNITS.length - 1) {
    n /= KB;
    i += 1;
  }
  return `${i === 0 ? n : n.toFixed(1)} ${UNITS[i]}`;
}

/** ISO → 로케일 상대/절대 표기용 Date. 파싱 실패 시 null. */
export function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? new Date(t) : null;
}
