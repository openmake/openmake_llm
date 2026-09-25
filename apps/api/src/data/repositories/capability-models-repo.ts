/**
 * @module data/repositories/capability-models-repo
 * @description capability→모델 배정 저장소 — 멀티모달 오케스트레이터 — 전역('__global__')·사용자 scope 공용.
 *
 * 2026-09-24 부터 이 저장소는 통합 테이블 `model_assignments`(config/model-slots 슬롯)를 감싸는 **어댑터**다 —
 * capability 는 CAPABILITY_SLOT 으로 슬롯에 대응하고, 돌려주는 row 는 요청한 capability 이름을 그대로 유지한다.
 * 옛 capability_models 테이블은 없다(마이그레이션 171 에서 DROP).
 *
 * 합쳐진 슬롯: text.code ↔ 'code'(역할 review 와 공유), text.reason ↔ 'reasoning'(역할 research 와 공유).
 *
 * "역할&모델"과 별개 축. 해석은 services/capability-resolver.
 *
 * @see data/repositories/model-assignments-repo · config/model-slots · db/migrations/170_model_assignments.sql
 */
import { BaseRepository } from './base-repository';
import { GLOBAL_CAPABILITY_SCOPE, type Capability } from '../../config/capabilities';
import { CAPABILITY_SLOT, getModelSlot } from '../../config/model-slots';
import { ModelAssignmentsRepository, type ModelAssignmentRow } from './model-assignments-repo';

export interface CapabilityModelRow {
    scope: string;
    capability: Capability;
    fullId: string;
    params: Record<string, string>;
    updatedAt: Date;
}

/** 슬롯 배정 row 를 요청 capability 이름을 유지한 capability row 로 변환 */
function toCapabilityRow(capability: Capability, row: ModelAssignmentRow): CapabilityModelRow {
    return { scope: row.scope, capability, fullId: row.fullId, params: row.params, updatedAt: row.updatedAt };
}

export class CapabilityModelsRepository extends BaseRepository {
    private get assignments(): ModelAssignmentsRepository {
        return new ModelAssignmentsRepository(this.pool);
    }

    async listByScope(scope: string): Promise<CapabilityModelRow[]> {
        const rows = await this.assignments.listByScope(scope);
        // 슬롯 → 그 슬롯을 읽는 capability(들). capability 를 안 가진 슬롯(순수 역할)은 목록에서 빠진다.
        const out: CapabilityModelRow[] = [];
        for (const row of rows) {
            for (const capability of getModelSlot(row.slot)?.capabilities ?? []) {
                out.push(toCapabilityRow(capability, row));
            }
        }
        return out.sort((a, b) => a.capability.localeCompare(b.capability));
    }

    async listGlobal(): Promise<CapabilityModelRow[]> {
        return this.listByScope(GLOBAL_CAPABILITY_SCOPE);
    }

    async get(scope: string, capability: Capability): Promise<CapabilityModelRow | null> {
        const slot = CAPABILITY_SLOT[capability];
        if (!slot) return null;
        const row = await this.assignments.get(scope, slot);
        return row ? toCapabilityRow(capability, row) : null;
    }

    /** 배정/변경 — 직전 fullId 를 함께 돌려준다(감사 로그용) */
    async upsert(
        scope: string,
        capability: Capability,
        fullId: string,
        params: Record<string, string>,
    ): Promise<{ row: CapabilityModelRow; previous: string | null }> {
        const slot = CAPABILITY_SLOT[capability];
        if (!slot) throw new Error(`capability '${capability}' 에 대응하는 슬롯이 없습니다`);
        const { row, previous } = await this.assignments.upsert(scope, slot, fullId, params);
        return { row: toCapabilityRow(capability, row), previous };
    }

    /** 미존재 시에만 삽입(시더용) — 이미 있으면 false */
    async insertIfAbsent(scope: string, capability: Capability, fullId: string): Promise<boolean> {
        const slot = CAPABILITY_SLOT[capability];
        if (!slot) return false;
        return this.assignments.insertIfAbsent(scope, slot, fullId);
    }

    async delete(scope: string, capability: Capability): Promise<boolean> {
        const slot = CAPABILITY_SLOT[capability];
        if (!slot) return false;
        return (await this.assignments.delete(scope, slot)).deleted;
    }
}
