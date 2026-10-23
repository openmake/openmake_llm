/**
 * MCP 카탈로그 from-catalog 입력 검증.
 *
 * 핵심 동작:
 *   - validateCatalogInput: args 는 args_schema.properties 키·원시값만, env 는 env_schema.properties 키만 허용
 *   - 제어 env 키(spawn-env-policy)는 스키마가 선언해도 거부
 *   - assertNoControlEnv: 수동 등록·git ingest 승인 등 다른 저장 경로가 쓰는 같은 제어 키 검사
 *
 */
import { isControlEnvKey, McpCatalogInputError } from '../../../security/spawn-env-policy';
import type { McpCatalogTemplate, McpFromCatalogPayload } from '../schemas/mcp-catalog.schema';

// 수동 등록·ingest 라우트가 이 모듈 하나로 검사와 오류 형식을 쓰게 다시 내보낸다(add-on 경계 — 새 Base import 없이).
export { McpCatalogInputError };

/**
 * 저장 전 제어 env 검사 — 제어 키(spawn-env-policy)가 있으면 키 이름만 담아 McpCatalogInputError(라우트 400)를 던진다.
 * 값은 메시지에 넣지 않는다. spawn 의 strip 은 과거에 저장된 행을 위한 방어선으로 그대로 둔다.
 * @throws {McpCatalogInputError}
 */
export function assertNoControlEnv(env: Record<string, unknown> | undefined | null): void {
    const control = Object.keys(env ?? {}).filter(isControlEnvKey);
    if (control.length > 0) throw new McpCatalogInputError(`허용되지 않은 환경변수 키: ${control.join(', ')}`);
}

type SchemaShape = { properties?: Record<string, unknown>; required?: unknown };

function schemaOf(raw: unknown): { keys: Set<string>; required: string[] } {
    const s = (raw ?? {}) as SchemaShape;
    const keys = new Set(Object.keys(s.properties ?? {}));
    const required = Array.isArray(s.required) ? s.required.filter((k): k is string => typeof k === 'string') : [];
    return { keys, required };
}

/**
 * from-catalog 입력 검증(2026-10-09 점검 ④) — args 는 args_schema.properties 안의 키·원시값만,
 * env 는 env_schema.properties 안의 키만 받고, 제어 env 키(spawn-env-policy)는 스키마가 선언해도 거부한다.
 * @throws {McpCatalogInputError}
 */
export function validateCatalogInput(template: McpCatalogTemplate, payload: McpFromCatalogPayload): void {
    const args = schemaOf(template.args_schema);
    const badArgKeys = Object.keys(payload.args).filter((k) => !args.keys.has(k));
    if (badArgKeys.length > 0) throw new McpCatalogInputError(`허용되지 않은 args 키: ${badArgKeys.join(', ')}`);
    const missingArgs = args.required.filter((k) => payload.args[k] === undefined);
    if (missingArgs.length > 0) throw new McpCatalogInputError(`필수 args 누락: ${missingArgs.join(', ')}`);
    const badArgValues = Object.entries(payload.args).filter(([, v]) => !['string', 'number', 'boolean'].includes(typeof v)).map(([k]) => k);
    if (badArgValues.length > 0) throw new McpCatalogInputError(`args 값은 문자열·숫자·불리언만 허용: ${badArgValues.join(', ')}`);

    const env = schemaOf(template.env_schema);
    assertNoControlEnv(payload.env);
    const badEnvKeys = Object.keys(payload.env).filter((k) => !env.keys.has(k));
    if (badEnvKeys.length > 0) throw new McpCatalogInputError(`허용되지 않은 환경변수 키: ${badEnvKeys.join(', ')}`);
}
