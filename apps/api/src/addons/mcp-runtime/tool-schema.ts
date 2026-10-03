/**
 * 외부 MCP 도구 스키마 → 내부 MCPTool 변환 (external-client 에서 분리 — 파일 크기 가드).
 *
 * 내부 도구 스키마는 type·properties·required 만 싣는다. 외부 서버(Pydantic·zod 생성 스키마)는 공용 타입을
 * 최상위 `$defs`(draft-07 은 `definitions`)에 두고 `$ref` 로 가리키는데, 최상위 정의가 버려지면 properties 안의
 * 참조가 끊긴 채 모델에 간다 — 모델은 그 인자의 모양을 모르고, 엄격한 문법 컴파일러는 스키마를 거절한다.
 * 그래서 로컬 참조를 정의 내용으로 풀어 넣는다(인라인).
 *
 * @module addons/mcp-runtime/tool-schema
 */
import type { MCPTool } from '../../tool-contract/types';
import { MCP_HIDDEN_TOOL_ARGS } from '../../config/runtime-limits';
import { MCP_TOOL_SCHEMA } from '../../config/agent-task-browser-web';

/** MCP 클라이언트(SDK)가 돌려주는 도구 형식. */
export interface SDKTool {
    name: string;
    description?: string;
    inputSchema?: {
        type: string;
        properties?: Record<string, unknown>;
        required?: string[];
        [key: string]: unknown;
    };
}

type Json = Record<string, unknown>;

/** 스키마 키워드로서의 정의 저장소 — 풀고 나면 버린다. */
const DEF_KEYS: ReadonlySet<string> = new Set(['$defs', 'definitions']);
/** 값이 "이름 → 스키마" 인 키워드 — 이름은 키워드가 아니므로(인자 이름이 definitions 일 수 있다) 값만 내려간다. */
const SCHEMA_MAP_KEYS: ReadonlySet<string> = new Set(['properties', 'patternProperties', 'dependentSchemas']);

function isObject(v: unknown): v is Json {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 로컬 JSON 포인터(`#/$defs/Name`)를 root 에서 찾는다. 외부 참조·없는 경로는 undefined. */
function lookupLocalRef(root: Json, ref: string): unknown {
    if (!ref.startsWith('#/')) return undefined;
    let cur: unknown = root;
    for (const raw of ref.slice(2).split('/')) {
        if (!isObject(cur)) return undefined;
        cur = cur[raw.replace(/~1/g, '/').replace(/~0/g, '~')];
    }
    return cur;
}

function resolveNode(node: unknown, root: Json, stack: readonly string[]): unknown {
    if (Array.isArray(node)) return node.map((item) => resolveNode(item, root, stack));
    if (!isObject(node)) return node;
    const out: Json = {};
    const ref = node.$ref;
    if (typeof ref === 'string') {
        // 순환(자기 참조)·깊이 상한·찾을 수 없는 참조는 풀지 않고 참조만 뗀다 — 제약 없는 스키마로 남는다.
        const target = stack.includes(ref) || stack.length >= MCP_TOOL_SCHEMA.REF_MAX_DEPTH ? undefined : lookupLocalRef(root, ref);
        if (isObject(target)) Object.assign(out, resolveNode(target, root, [...stack, ref]));
    }
    for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') continue;
        if (DEF_KEYS.has(key) && isObject(value)) continue;
        out[key] = SCHEMA_MAP_KEYS.has(key) && isObject(value)
            ? Object.fromEntries(Object.entries(value).map(([name, schema]) => [name, resolveNode(schema, root, stack)]))
            : resolveNode(value, root, stack);
    }
    return out;
}

/** PURE: 스키마의 로컬 `$ref` 를 정의 내용으로 풀고 최상위 정의(`$defs`·`definitions`)를 뺀 새 스키마. */
export function inlineLocalRefs(schema: Json): Json {
    return resolveNode(schema, schema, []) as Json;
}

/** SDK 도구 → 내부 MCPTool. 참조를 풀고, 호스트 프로토콜용 인자(MCP_HIDDEN_TOOL_ARGS)는 모델에게 보이지 않게 뺀다 — 보이면 지어낸다. */
export function sdkToolToMCPTool(sdkTool: SDKTool): MCPTool {
    const schema: Json = sdkTool.inputSchema ?? {};
    const resolved = MCP_TOOL_SCHEMA.INLINE_REFS_ENABLED ? inlineLocalRefs(schema) : schema;
    const properties = Object.fromEntries(
        Object.entries(isObject(resolved.properties) ? resolved.properties : {})
            .filter(([key]) => !MCP_HIDDEN_TOOL_ARGS.has(key)),
    );
    return {
        name: sdkTool.name,
        description: sdkTool.description || '',
        inputSchema: {
            type: 'object',
            properties,
            required: (sdkTool.inputSchema?.required || []).filter((key) => !MCP_HIDDEN_TOOL_ARGS.has(key)),
        },
    };
}
