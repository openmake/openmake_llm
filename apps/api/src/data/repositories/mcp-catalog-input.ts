/**
 * MCP 카탈로그 from-catalog 입력 검증.
 *
 * 핵심 동작:
 *   - validateCatalogInput: args 는 args_schema.properties 키·원시값만, env 는 env_schema.properties 키만 허용
 *   - 제어 env 키(spawn-env-policy)는 스키마가 선언해도 거부
 *
 */
import { isControlEnvKey, McpCatalogInputError } from '../../security/spawn-env-policy';
import type { McpCatalogTemplate, McpFromCatalogPayload } from '../../schemas/mcp-catalog.schema';

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
    const control = Object.keys(payload.env).filter(isControlEnvKey);
    if (control.length > 0) throw new McpCatalogInputError(`허용되지 않은 환경변수 키: ${control.join(', ')}`);
    const badEnvKeys = Object.keys(payload.env).filter((k) => !env.keys.has(k));
    if (badEnvKeys.length > 0) throw new McpCatalogInputError(`허용되지 않은 환경변수 키: ${badEnvKeys.join(', ')}`);
}
