/**
 * 관리자 MCP Registry 화면의 응답 타입과 표시 보조 — 훅 없음(테스트에서 바로 부른다).
 * 백엔드 `/api/extension-marketplace/registry/admin/*` 응답 모양과 짝이다.
 */
export type Curation = "pending" | "approved" | "hidden";

export interface RegistryRemote { type: string; url: string }
export interface RegistryPackage { registryType: string; identifier: string; version: string | null; transport: string }

export interface RegistryAdminEntry {
  serverName: string;
  namespace: string;
  version: string;
  title: string | null;
  description: string | null;
  remotes: RegistryRemote[];
  packages: RegistryPackage[];
  status: "active" | "deprecated" | "deleted";
  publisherVerified: boolean;
  promotedCatalogId: string | null;
  curation: Curation;
  curatedAt: string | null;
  tombstonedAt: string | null;
}

export interface RegistryStatus {
  syncEnabled: boolean;
  /** 서버 시각 기준 백오프 중인가(렌더 중 시계를 읽지 않으려고 서버가 판정한다) */
  backingOff: boolean;
  state: {
    cursor: string | null;
    lastSuccessAt: string | null;
    backoffUntil: string | null;
    lastError: string | null;
  };
  counts: Record<Curation | "tombstoned", number>;
  /** 빠른 작업(opt-in EXT_MARKET_REGISTRY_QUICK_ACTIONS) — 켜져 있을 때만 온다: 승인+올리기 한 번에, 입력 중 검색 */
  quickActions?: boolean;
}

/** 입력 중 검색 대기 시간(ms) — 72,000여 항목 ILIKE 라 글자마다 요청하지 않게 */
export const REGISTRY_SEARCH_DEBOUNCE_MS = 350;

/** 상태 응답 → 빠른 작업 화면 여부(꺼져 있거나 상태를 못 받았으면 종전 화면) */
export function quickActionsEnabled(status: { quickActions?: unknown } | null | undefined): boolean {
  return status?.quickActions === true;
}

export const CURATION_TONE: Record<Curation, "neutral" | "success" | "warn"> = {
  pending: "warn",
  approved: "success",
  hidden: "neutral",
};

/** 설치 방식 한 줄 — 원격 주소가 있으면 그것, 없으면 첫 패키지(레지스트리 종류:이름@판). 둘 다 없으면 null */
export function installSummary(e: Pick<RegistryAdminEntry, "remotes" | "packages">): string | null {
  const remote = e.remotes[0];
  if (remote) return `${remote.type} ${remote.url}`;
  const pkg = e.packages[0];
  if (pkg) return `${pkg.registryType}:${pkg.identifier}${pkg.version ? `@${pkg.version}` : ""}`;
  return null;
}
