/**
 * Knowledge add-on(웹) 순수 헬퍼 — 상태·실패코드 → i18n 키 매핑, 크기 표시. 부수효과 없음.
 * 컴포넌트는 useTranslations("knowledge") 로 받은 t 에 이 키를 넣어 문자열을 만든다.
 */
import type { KnowledgeVersionStatus } from "@openmake/shared-types";

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

/** 실패코드 → i18n 키(`failure.<key>`). 미등록 코드는 `failure.unknown`. */
export function failureMessageKey(code: string | null | undefined): string {
  switch (code) {
    case "FAILED_VALIDATION":
      return "failure.validation";
    case "SCANNED_PDF_UNSUPPORTED":
      return "failure.scannedPdf";
    case "FAILED_EXTRACTION":
      return "failure.extraction";
    case "FAILED_EMBEDDING":
      return "failure.embedding";
    default:
      return "failure.unknown";
  }
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
