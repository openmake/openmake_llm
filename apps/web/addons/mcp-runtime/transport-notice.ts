/**
 * 전송·엔드포인트 퇴역 안내의 순수 함수 (MCP-3) — 화면 컴포넌트와 분리해 테스트가 직접 검증한다. 백엔드 `transportNotice`
 * (apps/api/src/addons/mcp-runtime/transport-notices.ts). 플래그가 꺼져 있거나 해당 없으면 필드가 없어 그리지 않는다.
 * 연결 동작은 바뀌지 않는다 — SSE 서버도 계속 연결된다.
 */
export interface TransportNoticeView {
  code: "deprecated-transport" | "endpoint-sunset" | "endpoint-moved";
  replacementUrl: string | null;
  replacementVerified: boolean;
  sunsetDate: string | null;
  reauthRequired: boolean;
}

const TRANSPORT_NOTICE_CODES: ReadonlySet<string> = new Set(["deprecated-transport", "endpoint-sunset", "endpoint-moved"]);

/** 모르는 값(다른 판의 백엔드)은 그리지 않는다 */
export function parseTransportNotice(raw: unknown): TransportNoticeView | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<TransportNoticeView>;
  if (!r.code || !TRANSPORT_NOTICE_CODES.has(r.code)) return null;
  return {
    code: r.code,
    replacementUrl: typeof r.replacementUrl === "string" ? r.replacementUrl : null,
    replacementVerified: r.replacementVerified === true,
    sunsetDate: typeof r.sunsetDate === "string" ? r.sunsetDate : null,
    reauthRequired: r.reauthRequired === true,
  };
}

/** 안내 문장 — 배지 title 에 싣는다 */
export function transportNoticeHint(notice: TransportNoticeView, t: (key: string, values?: Record<string, string>) => string): string {
  const parts = [t(`hint.${notice.code}`)];
  if (notice.sunsetDate) parts.push(t("sunsetOn", { date: notice.sunsetDate }));
  if (notice.replacementUrl) {
    parts.push(t(notice.replacementVerified ? "replacement" : "replacementCandidate", { url: notice.replacementUrl }));
  }
  if (notice.reauthRequired) parts.push(t("reauth"));
  return parts.join(" ");
}

