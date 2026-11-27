/**
 * 갤러리 판정 배지의 순수 판정 — 서버 응답(`GET /api/extension-marketplace/verdicts`)을 배지 표시값으로 바꾼다.
 * React·화면을 import 하지 않아 api Jest 에서도 검증한다.
 */

export type MarketVerdict = "supported" | "partial" | "unsupported";

export interface MarketVerdictReason {
  code: string;
  severity: "blocking" | "degrading" | "info";
  count: number;
}

export interface MarketVerdictItem {
  plugin: string;
  verdict: MarketVerdict;
  reasons: MarketVerdictReason[];
  provenance: { publisher: string | null; commit: string | null; license: string | null; sourceUrl: string };
  evaluated: "snapshot" | "installed";
}

export interface VerdictBadgeView {
  verdict: MarketVerdict;
  /** 배지 색 — success·warn·danger */
  tone: "success" | "warn" | "danger";
  /** 판정을 낮춘 사유(blocking·degrading) 코드 — 표시 순서: blocking 먼저 */
  causes: string[];
  /** 참고 사유(info) 코드 */
  notes: string[];
  /** 짧은 커밋(앞 7자) */
  shortCommit: string | null;
  publisher: string | null;
  license: string | null;
  snapshotOnly: boolean;
}

const TONE: Record<MarketVerdict, VerdictBadgeView["tone"]> = {
  supported: "success",
  partial: "warn",
  unsupported: "danger",
};

const KNOWN_VERDICTS = new Set<string>(["supported", "partial", "unsupported"]);

/** PURE: 응답 목록 → 플러그인 이름별 배지 값. 모양이 틀린 항목은 버린다(배지를 안 그릴 뿐 갤러리는 그대로) */
export function buildVerdictViews(items: unknown): Map<string, VerdictBadgeView> {
  const out = new Map<string, VerdictBadgeView>();
  if (!Array.isArray(items)) return out;
  for (const raw of items as Partial<MarketVerdictItem>[]) {
    if (!raw || typeof raw.plugin !== "string" || typeof raw.verdict !== "string" || !KNOWN_VERDICTS.has(raw.verdict)) continue;
    const reasons = Array.isArray(raw.reasons) ? raw.reasons.filter((r) => r && typeof r.code === "string") : [];
    const order = (s: string) => (s === "blocking" ? 0 : 1);
    const causes = reasons
      .filter((r) => r.severity === "blocking" || r.severity === "degrading")
      .sort((a, b) => order(a.severity) - order(b.severity) || a.code.localeCompare(b.code))
      .map((r) => r.code);
    const notes = reasons.filter((r) => r.severity === "info").map((r) => r.code);
    const p = raw.provenance;
    out.set(raw.plugin, {
      verdict: raw.verdict as MarketVerdict,
      tone: TONE[raw.verdict as MarketVerdict],
      causes,
      notes,
      shortCommit: p && typeof p.commit === "string" && p.commit ? p.commit.slice(0, 7) : null,
      publisher: p && typeof p.publisher === "string" ? p.publisher : null,
      license: p && typeof p.license === "string" ? p.license : null,
      snapshotOnly: raw.evaluated !== "installed",
    });
  }
  return out;
}
