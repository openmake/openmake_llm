/**
 * MCP 서버가 선언한 확장(MCP-5)의 순수 함수 — 화면 컴포넌트와 분리해 테스트가 직접 검증한다. 백엔드 `declaredExtensions`
 * (apps/api/src/addons/mcp-runtime/extension-awareness.ts). 플래그가 꺼져 있거나 선언이 없으면 필드가 없어 그리지 않는다.
 * OpenMake 는 확장을 실행하지 않는다 — 배지는 "인식했으나 미지원" 을 알릴 뿐이다.
 */
export type DeclaredExtensionKind = "apps" | "tasks" | "skills" | "auth" | "events" | "unknown";

export interface DeclaredExtensionView {
  id: string;
  version: string | null;
  kind: DeclaredExtensionKind;
}

const KINDS: ReadonlySet<string> = new Set(["apps", "tasks", "skills", "auth", "events", "unknown"]);

/** 모르는 모양·종류는 버린다(다른 판의 백엔드). 없으면 빈 배열 */
export function parseDeclaredExtensions(raw: unknown): DeclaredExtensionView[] {
  if (!Array.isArray(raw)) return [];
  const out: DeclaredExtensionView[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as { id?: unknown; version?: unknown; kind?: unknown };
    if (typeof r.id !== "string" || !r.id) continue;
    const kind = typeof r.kind === "string" && KINDS.has(r.kind) ? (r.kind as DeclaredExtensionKind) : "unknown";
    out.push({ id: r.id, version: typeof r.version === "string" && r.version ? r.version : null, kind });
  }
  return out;
}

/** 배지에 쓸 종류 목록 — 같은 종류는 한 번(표시 순서 고정) */
export function declaredExtensionKinds(list: readonly DeclaredExtensionView[]): DeclaredExtensionKind[] {
  const order: DeclaredExtensionKind[] = ["skills", "apps", "tasks", "events", "auth", "unknown"];
  const present = new Set(list.map(e => e.kind));
  return order.filter(k => present.has(k));
}

/** 배지 title — 해당 종류의 확장 id(버전) 목록 */
export function declaredExtensionTitle(list: readonly DeclaredExtensionView[], kind: DeclaredExtensionKind, hint: string): string {
  const ids = list.filter(e => e.kind === kind).map(e => (e.version ? `${e.id}@${e.version}` : e.id));
  return `${hint} (${ids.join(", ")})`;
}
