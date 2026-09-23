/**
 * Registry 스냅샷 → Planner 계약 (P03, 2026-09-23).
 *
 * 한 요청 안에서 Planner 프롬프트(기능 목록)·구조화 출력 JSON schema·의미 검증(plannable 집합)은 **같은 스냅샷** 하나를
 * 쓴다(계획서 8.1) — 각각 따로 조회해 다른 revision 을 보지 않는다. 실행 직전 admission 이 최신 상태를 다시 확인하므로
 * 계획 뒤 꺼진 기능은 거기서 거절된다.
 *
 * 구조화 출력은 선언 안 된 키를 만들지 않으므로(2026-09-22 실측) 계획 인자 키는 plannable capability 의 `inputSchema.properties`
 * 를 합쳐 schema 에 싣는다. dialect 는 1차 범위(type·enum·description)로 제한하고 `$ref` 는 Registry 가 거절한다.
 * 모델용 schema 가 표현하지 못한 제약은 서버(validatePlan·실행기)가 반드시 다시 검증한다.
 *
 * @module capability-contract/plan-schema
 */
import * as crypto from 'node:crypto';
import type { RegistrySnapshot } from './registry';
import type { CapabilityDefinition, CapabilityOwner, JsonSchema } from './types';

export interface ExecutionSnapshot {
    registryRevision: number;
    capabilities: ReadonlyArray<{ definition: CapabilityDefinition; owner: CapabilityOwner }>;
    /** Planner 가 쓸 수 있는 capability id */
    plannable: ReadonlySet<string>;
    /** plannable capability 들의 계획 인자 키 합집합(schema 투영) */
    inputProperties: Readonly<Record<string, JsonSchema>>;
    /** schema 투영의 해시 — 기록·비교용 */
    schemaHash: string;
}

/** PURE */
export function buildExecutionSnapshot(registry: RegistrySnapshot): ExecutionSnapshot {
    const plannableEntries = registry.entries.filter(e => e.definition.plannable);
    const inputProperties: Record<string, JsonSchema> = {};
    for (const e of plannableEntries) {
        const props = (e.definition.inputSchema as { properties?: Record<string, JsonSchema> }).properties ?? {};
        for (const [k, v] of Object.entries(props)) inputProperties[k] ??= v;
    }
    const schemaHash = crypto.createHash('sha256').update(JSON.stringify({ r: registry.revision, p: inputProperties, ids: plannableEntries.map(e => e.definition.id).sort() })).digest('hex').slice(0, 16);
    return {
        registryRevision: registry.revision,
        capabilities: registry.entries,
        plannable: new Set(plannableEntries.map(e => e.definition.id)),
        inputProperties,
        schemaHash,
    };
}

/** vLLM json_schema / OpenAI response_format 용 — 종전 `PLAN_JSON_SCHEMA` 와 같은 뼈대, 인자 키만 스냅샷에서 */
export function planJsonSchemaFor(snapshot: ExecutionSnapshot): JsonSchema {
    return {
        type: 'object',
        properties: {
            complexity: { type: 'string', enum: ['simple', 'multi'] },
            language: { type: 'string' },
            tasks: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        capability: { type: 'string' },
                        input: {
                            type: 'object',
                            properties: {
                                instruction: { type: 'string' },
                                text: { type: 'string' },
                                attachments: { type: 'array', items: { type: 'string' } },
                                refs: { type: 'array', items: { type: 'string' } },
                                ...snapshot.inputProperties,
                            },
                        },
                        depends_on: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['id', 'capability'],
                },
            },
            synthesis: { type: 'boolean' },
        },
        required: ['complexity', 'tasks'],
    };
}

/** Planner 프롬프트의 기능 목록 줄 — display.order 순 */
export function plannerCapabilityLines(snapshot: ExecutionSnapshot): string {
    return snapshot.capabilities
        .filter(e => e.definition.plannable)
        .sort((a, b) => a.definition.display.order - b.definition.display.order)
        .map(e => `- ${e.definition.id}: ${e.definition.plannerHint}`)
        .join('\n');
}
