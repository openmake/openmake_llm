/**
 * Capability Registry — 정의 검증·소유·중복 방지·revision 을 가진 단일 표 (P02, 2026-09-23).
 *
 * 연산(계획서 6.3):
 *   beginRegistration(owner) → tx.register(definition, handler)… → tx.commit() | tx.rollback()
 * 등록은 **원자적**이다 — commit 전에는 아무것도 게시되지 않고, 실패하면 그 owner 의 임시 등록만 버린다(다른 add-on 무영향).
 * 같은 ID 는 단일 소유만 허용한다(부팅 순서로 승자를 정하지 않는다) — 사전 소유 검사는 `checkCapabilityOwnership`.
 * `revision` 은 게시·회수마다 증가해 스냅샷·승인 handle 이 "그 뒤 바뀌었나" 를 판정한다.
 * 이 모듈은 LLM·DB 를 모른다(순수) — 프로세스 싱글턴은 `runtime-ports/capability-runtime.ts` 가 든다.
 *
 * @module capability-contract/registry
 */
import { CapabilityRegistryError } from './errors';
import type { CapabilityDefinition, CapabilityHandler, CapabilityId, CapabilityOwner, CapabilityRegistration, JsonSchema } from './types';

const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/;
/** 스키마 크기·깊이 상한 — 외부 manifest 의 문자열이 무한히 커지지 않게 */
const SCHEMA_MAX_JSON_CHARS = 16_000;
const SCHEMA_MAX_DEPTH = 6;

function schemaDepth(v: unknown, depth = 0): number {
    if (!v || typeof v !== 'object') return depth;
    return Math.max(depth, ...Object.values(v as Record<string, unknown>).map(x => schemaDepth(x, depth + 1)));
}

function validateSchema(id: CapabilityId, name: string, schema: JsonSchema): void {
    const text = JSON.stringify(schema);
    if (text.length > SCHEMA_MAX_JSON_CHARS) throw new CapabilityRegistryError(`${id}: ${name} 이 너무 큽니다 (${text.length} > ${SCHEMA_MAX_JSON_CHARS})`, 'CAPABILITY_ID_INVALID');
    if (schemaDepth(schema) > SCHEMA_MAX_DEPTH) throw new CapabilityRegistryError(`${id}: ${name} 깊이 초과 (> ${SCHEMA_MAX_DEPTH})`, 'CAPABILITY_ID_INVALID');
    if (text.includes('"$ref"')) throw new CapabilityRegistryError(`${id}: ${name} 에 $ref 는 허용하지 않습니다`, 'CAPABILITY_ID_INVALID');
}

export function validateCapabilityDefinition(def: CapabilityDefinition): void {
    if (!CAPABILITY_ID_PATTERN.test(def.id)) throw new CapabilityRegistryError(`capability id 문법 오류: '${def.id}'`, 'CAPABILITY_ID_INVALID');
    if (def.contractVersion !== 1) throw new CapabilityRegistryError(`${def.id}: 지원하지 않는 contractVersion ${String(def.contractVersion)}`, 'CAPABILITY_ID_INVALID');
    if (!def.display?.label || !def.display.group) throw new CapabilityRegistryError(`${def.id}: display.label/group 필수`, 'CAPABILITY_ID_INVALID');
    if (!Number.isFinite(def.execution?.timeoutMs) || def.execution.timeoutMs <= 0) throw new CapabilityRegistryError(`${def.id}: execution.timeoutMs 는 양수`, 'CAPABILITY_ID_INVALID');
    validateSchema(def.id, 'inputSchema', def.inputSchema);
    validateSchema(def.id, 'settingsSchema', def.settingsSchema);
}

export interface RegistrationTx {
    register(definition: CapabilityDefinition, handler: CapabilityHandler): void;
    /** 임시 등록을 게시한다. `expected` 를 주면 등록 결과와 manifest 선언이 정확히 일치해야 한다 */
    commit(expected?: readonly CapabilityId[]): void;
    rollback(): void;
}

export interface RegistrySnapshot {
    revision: number;
    entries: ReadonlyArray<{ definition: CapabilityDefinition; owner: CapabilityOwner }>;
}

export class CapabilityRegistry {
    private published = new Map<CapabilityId, CapabilityRegistration>();
    private rev = 0;

    get revision(): number { return this.rev; }

    beginRegistration(owner: CapabilityOwner): RegistrationTx {
        const staged = new Map<CapabilityId, CapabilityRegistration>();
        let closed = false;
        const assertOpen = () => { if (closed) throw new CapabilityRegistryError(`'${owner.addonId}' 등록 트랜잭션이 이미 닫혔습니다`, 'CAPABILITY_DUPLICATE'); };
        return {
            register: (definition, handler) => {
                assertOpen();
                validateCapabilityDefinition(definition);
                if (typeof handler?.execute !== 'function') throw new CapabilityRegistryError(`${definition.id}: handler.execute 가 없습니다`, 'CAPABILITY_ID_INVALID');
                if (staged.has(definition.id)) throw new CapabilityRegistryError(`${definition.id}: 같은 트랜잭션에 중복 등록`, 'CAPABILITY_DUPLICATE');
                const existing = this.published.get(definition.id);
                if (existing && existing.owner.addonId !== owner.addonId) {
                    throw new CapabilityRegistryError(`${definition.id}: 이미 '${existing.owner.addonId}' 가 소유 — '${owner.addonId}' 는 등록할 수 없습니다`, 'CAPABILITY_OWNERSHIP_CONFLICT');
                }
                staged.set(definition.id, { definition, owner: { ...owner }, handler });
            },
            commit: (expected) => {
                assertOpen();
                if (expected) {
                    const got = [...staged.keys()].sort(); const want = [...expected].sort();
                    if (got.length !== want.length || got.some((id, i) => id !== want[i])) {
                        throw new CapabilityRegistryError(`'${owner.addonId}' 등록 결과가 manifest 선언과 다릅니다 — 선언 [${want.join(', ')}] · 등록 [${got.join(', ')}]`, 'CAPABILITY_PROVIDES_MISMATCH');
                    }
                }
                for (const [id, reg] of staged) this.published.set(id, reg);
                closed = true;
                this.rev++;
            },
            rollback: () => { staged.clear(); closed = true; },
        };
    }

    /** 소유 add-on 의 등록을 전부 회수한다(부분 등록 정리·중지). 회수한 ID 목록을 돌려준다 */
    unregisterOwner(addonId: string): CapabilityId[] {
        const removed: CapabilityId[] = [];
        for (const [id, reg] of this.published) if (reg.owner.addonId === addonId) { this.published.delete(id); removed.push(id); }
        if (removed.length > 0) this.rev++;
        return removed;
    }

    get(id: CapabilityId): CapabilityRegistration | undefined { return this.published.get(id); }
    has(id: CapabilityId): boolean { return this.published.has(id); }
    list(): CapabilityRegistration[] { return [...this.published.values()]; }

    /** 함수 없는 metadata 스냅샷(웹·API·Planner 공용) — 같은 요청 안에서는 이 하나를 돌려 쓴다 */
    snapshot(): RegistrySnapshot {
        return { revision: this.rev, entries: this.list().map(r => ({ definition: r.definition, owner: r.owner })) };
    }

    /** 테스트 정리용 */
    resetForTest(): void { this.published.clear(); this.rev = 0; }
}

/**
 * PURE: 부팅 전 소유권 사전 검사(계획서 6.3). 같은 ID 를 두 add-on 이 선언하면 **양쪽 다** 거절 대상에 올린다.
 * Base 예약 ID 와 충돌하는 add-on 은 그 add-on 만 거절한다(Base 등록은 유지).
 */
export function checkCapabilityOwnership(
    claims: ReadonlyArray<{ addonId: string; provides: readonly CapabilityId[] }>,
    baseIds: ReadonlySet<CapabilityId>,
): { rejected: Map<string, string> } {
    const rejected = new Map<string, string>();
    const byId = new Map<CapabilityId, string[]>();
    for (const c of claims) for (const id of c.provides) byId.set(id, [...(byId.get(id) ?? []), c.addonId]);
    for (const [id, owners] of byId) {
        if (baseIds.has(id)) for (const o of owners) rejected.set(o, `${rejected.get(o) ? `${rejected.get(o)}; ` : ''}'${id}' 는 Base 예약 capability`);
        else if (owners.length > 1) for (const o of owners) rejected.set(o, `${rejected.get(o) ? `${rejected.get(o)}; ` : ''}'${id}' 를 ${owners.join('·')} 이 함께 선언 — 단일 소유만 허용`);
    }
    return { rejected };
}
