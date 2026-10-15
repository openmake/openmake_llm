/**
 * add-on 전용 라우트의 가용성 오류 분류 — 서버 계약(docs/architecture/addon-platform.md 8.3):
 *   404 ADDON_DISABLED       관리자가 껐다(재시도 무의미)
 *   503 ADDON_STATE_UNKNOWN  상태를 확인하지 못했다(일시, 재시도 가능)
 *   503 ADDON_FAILED         부팅에 실패했다(관리자 조치 필요, 재시도 무의미)
 * 상태 코드와 error.code 를 함께 봐야 한다 — 일반 404(없는 리소스)·500 과 섞지 않는다.
 */
export type AddonAvailabilityKind = "disabled" | "unavailable" | "failed" | "other";

/** ApiError(status + body)·ApiError 를 감싼 오류(status + code) 어느 쪽에서든 status·code 를 뽑는다 */
export function addonErrorOf(e: unknown): { status?: number; code?: string } {
  if (!e || typeof e !== "object") return { status: undefined, code: undefined };
  const o = e as { status?: unknown; code?: unknown; body?: { error?: { code?: unknown } } };
  const status = typeof o.status === "number" ? o.status : undefined;
  const bodyCode = o.body?.error?.code;
  const code = typeof bodyCode === "string" ? bodyCode : typeof o.code === "string" ? o.code : undefined;
  return { status, code };
}

export function classifyAddonError(status: number | undefined, code: string | undefined): AddonAvailabilityKind {
  if (status === 503 && code === "ADDON_STATE_UNKNOWN") return "unavailable";
  if (status === 503 && code === "ADDON_FAILED") return "failed";
  if (status === 404 && code === "ADDON_DISABLED") return "disabled";
  return "other";
}

const MESSAGE_KEYS: Record<AddonAvailabilityKind, "disabledByAdmin" | "unavailable" | "notReady" | "serverError"> = {
  disabled: "disabledByAdmin",
  unavailable: "unavailable",
  failed: "notReady",
  other: "serverError",
};

export function addonAvailabilityMessageKey(kind: AddonAvailabilityKind): "disabledByAdmin" | "unavailable" | "notReady" | "serverError" {
  return MESSAGE_KEYS[kind];
}
