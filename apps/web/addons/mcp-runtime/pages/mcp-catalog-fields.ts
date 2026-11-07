/**
 * MCP 카탈로그 설치 폼의 순수 함수 — 템플릿 → 입력 필드, 입력값 → from-catalog payload.
 * 페이지(mcp-catalog-page.tsx)에서 분리해 tests/web/mcp-catalog-args.test.ts 가 직접 검증한다.
 */

export type CatalogKind = "server" | "skill";

/**
 * 설치 시 입력받는 필드. args_schema(kind 'arg') 또는 env_schema(kind 'env') 에서 파생(required + 선택 항목).
 * args 는 secret 이 아니다. type 은 args 의 JSON 변환에만 쓴다.
 */
export interface InstallField {
  key: string;
  title: string;
  description?: string;
  secret: boolean;
  /** schema.required 에 있으면 true — 빈 값이면 설치 버튼이 잠긴다. */
  required: boolean;
  kind: "arg" | "env";
  type?: "string" | "number" | "boolean";
}

export interface CatalogEntry {
  id: string;
  name: string;
  provider: string;
  description: string;
  toolCount: number;
  kind: CatalogKind;
  installed?: boolean;
  /** 설치 폼에 노출할 args 필드 — 서버 실행 인자(예: Filesystem 의 root_path). 필수 먼저. */
  argFields: InstallField[];
  /** 설치 폼에 노출할 env 필드 — 필수 먼저, 선택(채널 제한·베이스 URL 등)이 뒤. */
  envFields: InstallField[];
}

/* ── 백엔드 응답 타입 (GET /api/mcp/catalog) ──────────────── */
interface ApiFieldSchema {
  type?: string;
  required?: string[];
  properties?: Record<
    string,
    { title?: string; description?: string; secret?: boolean; type?: string }
  >;
}

export interface ApiCatalogTemplate {
  id: string;
  display_name: string;
  description?: string;
  transport_type: "stdio" | "sse" | "streamable-http";
  is_enabled?: boolean;
  args_schema?: ApiFieldSchema;
  env_schema?: ApiFieldSchema;
}

/** JSON schema type → 변환용 타입. integer 는 number 로, 모르는 값은 string. */
function fieldType(type: string | undefined): InstallField["type"] {
  if (type === "number" || type === "integer") return "number";
  if (type === "boolean") return "boolean";
  return "string";
}

// schema 의 모든 속성을 설치 폼에 노출한다 — required 는 필수 입력, 나머지는 선택
// (Slack 채널 제한·CircleCI 베이스 URL 처럼 설치 시점에만 넣을 수 있던 값이 화면에서 빠져 있었다).
function toFields(schema: ApiFieldSchema | undefined, kind: InstallField["kind"]): InstallField[] {
  const props = schema?.properties ?? {};
  const required = schema?.required ?? [];
  const toField = (key: string, isRequired: boolean): InstallField => ({
    key,
    title: props[key]?.title || key,
    description: props[key]?.description,
    // args 는 secret 이 아니다(서버도 args 를 암호화하지 않는다)
    secret: kind === "env" && props[key]?.secret === true,
    required: isRequired,
    kind,
    ...(kind === "arg" ? { type: fieldType(props[key]?.type) } : {}),
  });
  return [
    ...required.map((key) => toField(key, true)),
    ...Object.keys(props).filter((key) => !required.includes(key)).map((key) => toField(key, false)),
  ];
}

export function mapTemplate(t: ApiCatalogTemplate): CatalogEntry {
  return {
    id: t.id,
    name: t.display_name,
    // 카탈로그 템플릿은 provider/도구수/skill 구분 필드를 제공하지 않음.
    // provider 는 transport_type, 종류는 항상 server 로 표기.
    provider: t.transport_type,
    description: t.description || "",
    toolCount: 0,
    kind: "server",
    argFields: toFields(t.args_schema, "arg"),
    envFields: toFields(t.env_schema, "env"),
  };
}

/** 필수 필드 중 비어 있는 것이 있으면 true — 설치 버튼 잠금 조건. */
export function hasMissingRequired(fields: InstallField[], draft: Record<string, string>): boolean {
  return fields.some((f) => f.required && !draft[f.key]?.trim());
}

/** 입력 문자열 → args 값. number 는 Number(), boolean 은 'true'|'false' 만 변환, 그 밖은 문자열 그대로(서버가 판정). */
function convertArg(f: InstallField, v: string): string | number | boolean {
  if (f.type === "number") {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  if (f.type === "boolean") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return v;
}

export interface InstallPayload {
  template_id: string;
  name: string;
  args?: Record<string, string | number | boolean>;
  env?: Record<string, string>;
}

/**
 * POST /api/mcp/servers/from-catalog 본문. 빈 칸은 보내지 않는다 — 선택 항목을 비워두면
 * 서버 기본값(스키마 default)이 적용된다. 필수 누락 판정은 서버(validateCatalogInput)가 최종으로 한다.
 */
export function buildInstallPayload(
  e: CatalogEntry,
  args: Record<string, string>,
  env: Record<string, string>,
  name: string,
): InstallPayload {
  const filledArgs = Object.fromEntries(
    e.argFields
      .filter((f) => (args[f.key] ?? "").trim().length > 0)
      .map((f) => [f.key, convertArg(f, args[f.key])]),
  );
  const filledEnv = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v.trim().length > 0),
  );
  return {
    template_id: e.id,
    name, // 인스턴스 이름 = 도구 네임스페이스. 영숫자/_/- 만 허용.
    ...(Object.keys(filledArgs).length > 0 ? { args: filledArgs } : {}),
    ...(Object.keys(filledEnv).length > 0 ? { env: filledEnv } : {}),
  };
}
