/**
 * @module data/repositories/global-model-roles-repo
 * @description 전역 역할→모델 매핑 (Admin UI, L3) 저장소.
 *
 * 2026-09-24 부터 이 저장소는 통합 테이블 `model_assignments`(scope='__global__', config/model-slots 슬롯)를 감싸는
 * **어댑터**다 — role 은 ROLE_SLOT 으로 슬롯에 대응하고, 돌려주는 row 는 요청한 role 이름을 그대로 유지한다.
 * 옛 global_model_roles 테이블은 없다(마이그레이션 171 에서 DROP).
 *
 * 해석 우선순위에서 사용자 매핑 다음, env 전역 이전에 조회된다.
 * @see data/repositories/model-assignments-repo · config/model-slots · db/migrations/170_model_assignments.sql
 */
import { BaseRepository } from './base-repository';
import type { ModelRole } from '../../config/model-roles';
import { GLOBAL_CAPABILITY_SCOPE } from '../../config/capabilities';
import { ROLE_SLOT, getModelSlot } from '../../config/model-slots';
import { ModelAssignmentsRepository } from './model-assignments-repo';

interface GlobalModelRoleRow {
    role: ModelRole;
    fullModelId: string;
    updatedAt: Date;
}

export class GlobalModelRolesRepository extends BaseRepository {
    private get assignments(): ModelAssignmentsRepository {
        return new ModelAssignmentsRepository(this.pool);
    }

    async list(): Promise<GlobalModelRoleRow[]> {
        const rows = await this.assignments.listByScope(GLOBAL_CAPABILITY_SCOPE);
        const out: GlobalModelRoleRow[] = [];
        for (const row of rows) {
            for (const role of getModelSlot(row.slot)?.roles ?? []) {
                out.push({ role, fullModelId: row.fullId, updatedAt: row.updatedAt });
            }
        }
        return out.sort((a, b) => a.role.localeCompare(b.role));
    }

    /** 배정/변경 — 직전 값(previous)을 함께 반환한다(감사·소실 복원 근거) */
    async upsert(
        role: ModelRole,
        fullModelId: string,
    ): Promise<{ mapping: GlobalModelRoleRow; previous: string | null }> {
        const slot = ROLE_SLOT[role];
        if (!slot) throw new Error(`role '${role}' 에 대응하는 슬롯이 없습니다`);
        const { row, previous } = await this.assignments.upsert(GLOBAL_CAPABILITY_SCOPE, slot, fullModelId, {});
        return { mapping: { role, fullModelId: row.fullId, updatedAt: row.updatedAt }, previous };
    }

    /** 매핑 해제 — 삭제된 직전 값(previous)을 함께 반환 */
    async delete(role: ModelRole): Promise<{ deleted: boolean; previous: string | null }> {
        const slot = ROLE_SLOT[role];
        if (!slot) return { deleted: false, previous: null };
        return this.assignments.delete(GLOBAL_CAPABILITY_SCOPE, slot);
    }
}
