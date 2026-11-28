/**
 * 갤러리 카탈로그 원본 묶음 (opt-in `EXTENSION_GALLERY_GROUP_SOURCES`, 2026-11-28) — 순수 함수.
 *
 * 플러그인이 여럿인 원본(예: ruvnet/ruflo — 49개)을 "전체 원본" 목록에서 한 줄 카드로 묶는다.
 * 카드를 누르면 기존 원본 선택(드롭다운과 같은 상태)으로 들어가 그 원본의 플러그인을 본다.
 * 서버 응답에 `groupSources: true` 가 없으면 묶지 않는다(종전 화면 그대로).
 */

export interface GroupableSource {
  id: string;
  name: string;
  plugins: Array<{ installable?: boolean; hasMcp?: boolean }>;
}

export interface CatalogGroup {
  id: string;
  name: string;
  /** 설치 가능한 플러그인 수(installable !== false — 목록에 보이는 수와 같다) */
  installable: number;
  /** 그중 MCP 정의를 가진 플러그인 수(hasMcp === true). 동기화 전 스냅샷이면 0 */
  mcp: number;
}

/** 갤러리 응답 → 묶음 화면 여부 */
export function catalogGroupingEnabled(gallery: { groupSources?: unknown } | null | undefined): boolean {
  return gallery?.groupSources === true;
}

/** 설치 가능한 플러그인이 2개 이상인 원본만 묶음 카드가 된다(1개짜리는 종전 목록에 그대로) */
export function catalogGroups(sources: readonly GroupableSource[]): CatalogGroup[] {
  const out: CatalogGroup[] = [];
  for (const s of sources) {
    const visible = s.plugins.filter((p) => p.installable !== false);
    if (visible.length < 2) continue;
    out.push({ id: s.id, name: s.name, installable: visible.length, mcp: visible.filter((p) => p.hasMcp === true).length });
  }
  return out;
}

/**
 * 묶음 화면을 쓸 때인가 — 플래그가 켜졌고, 특정 원본을 고르지 않았고, 검색어가 없을 때.
 * 검색은 원본을 가로질러 플러그인을 찾는 용도라 묶지 않는다(이름으로 바로 찾을 수 있게).
 */
export function isGroupedCatalogView(enabled: boolean, selectedSourceId: string, searchQuery: string): boolean {
  return enabled && !selectedSourceId && searchQuery.trim() === "";
}
