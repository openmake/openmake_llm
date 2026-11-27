/**
 * 확장 설치 미리보기(M1b) — 서버 계약 `POST /api/users/me/extensions/catalog/:id/preview`
 * (apps/api agents/git-ingest/extension-install-preview). 갤러리 응답에 `installPreview: true` 가 있을 때만 켜진다 —
 * 플래그 OFF(필드 없음)면 설치 버튼이 종전처럼 바로 설치한다.
 */

export interface InstallPreviewSkill {
  path: string;
  name?: string;
  description?: string;
  fromCommand?: boolean;
  compatNotes?: string[];
  assets?: string[];
  error?: string;
}

export interface InstallPreviewHint {
  code: string;
  detail?: Record<string, string | boolean | null>;
}

export interface InstallPreviewMcpServer {
  name: string;
  transportType: string;
  command?: string;
  url?: string;
  blockedByConvention: boolean;
  findings: Array<{ severity: string; rule: string; message: string }>;
  networkRestricted: boolean;
  requiredEnv: string[];
  hints: InstallPreviewHint[];
  excluded?: string;
}

export interface InstallPreviewAgent {
  path: string;
  name: string;
  plannedName: string;
  description?: string;
  requiresApproval: boolean;
  ignoredFields?: string[];
  error?: string;
}

export interface ExtensionInstallPreview {
  extension: { name: string; version: string; description: string };
  source: { url: string; requestedUrl: string; commit: string; path: string; trackingRef: string | null };
  commit: string;
  components: { skills: InstallPreviewSkill[]; mcpServers: InstallPreviewMcpServer[]; agents: InstallPreviewAgent[] };
  permissions: { requested: string[] | null; blocked: string[]; state: string };
  existingInstall: { extensionId: string; version: string; sameSource: boolean; upToDate: boolean } | null;
  warnings: string[];
}

/** 갤러리 응답 → 카탈로그 설치 버튼 동작. 필드가 없으면(플래그 OFF·구 서버) 종전처럼 바로 설치 */
export function catalogInstallMode(gallery: { installPreview?: unknown } | null | undefined): "preview" | "direct" {
  return gallery?.installPreview === true ? "preview" : "direct";
}

/** MCP 안내 코드 → 번역 키(`extensions.preview.hint.<key>`). 모르는 코드는 null(표시 안 함) */
const HINT_KEYS: Record<string, string> = {
  "deprecated-transport": "deprecatedTransport",
  "endpoint-sunset": "endpointSunset",
  "endpoint-moved": "endpointMoved",
  "remote-auth-may-be-required": "remoteAuth",
};

export function previewHintKey(code: string): string | null {
  return HINT_KEYS[code] ?? null;
}

/** 경고 문자열의 코드(`CODE: 설명`) — 화면은 코드별로 묶지 않고 원문을 보이되 코드는 굵게 */
export function splitWarning(w: string): { code: string | null; text: string } {
  const m = /^([A-Z][A-Z0-9_]+):\s*([\s\S]*)$/.exec(w);
  return m ? { code: m[1], text: m[2] } : { code: null, text: w };
}

/** 설치될(제외·오류가 아닌) 구성요소 수 */
export function installableCounts(p: ExtensionInstallPreview): { skills: number; mcpServers: number; agents: number } {
  return {
    skills: p.components.skills.filter((s) => !s.error).length,
    mcpServers: p.components.mcpServers.filter((m) => !m.excluded).length,
    agents: p.components.agents.filter((a) => !a.error).length,
  };
}

/** 미리볼 대상 — 카탈로그 항목(설치 버튼) 또는 이름 설치(`플러그인@마켓플레이스` 입력) */
export type InstallPreviewTarget =
  | { kind?: "catalog"; sourceId: string; plugin?: string; label: string }
  | { kind: "named"; ref: string; label: string };

/** 대상 → 미리보기 요청. 이름 설치는 설치(`/install-by-name`)와 같은 해석·입력을 쓰는 `/preview-by-name` */
export function previewRequest(target: InstallPreviewTarget): { path: string; body: Record<string, string> } {
  if (target.kind === "named") return { path: "/api/users/me/extensions/preview-by-name", body: { ref: target.ref } };
  return {
    path: `/api/users/me/extensions/catalog/${target.sourceId}/preview`,
    body: target.plugin ? { plugin: target.plugin } : {},
  };
}

/** 이름 설치 입력의 동작 — 갤러리가 미리보기 모드면 미리보기 대상, 아니면 바로 설치(null) */
export function namedInstallPreviewTarget(mode: "preview" | "direct", ref: string): InstallPreviewTarget | null {
  return mode === "preview" ? { kind: "named", ref, label: ref } : null;
}
