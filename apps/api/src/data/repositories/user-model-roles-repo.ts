/**
 * @module data/repositories/user-model-roles-repo
 * @description 사용자별 역할→모델 매핑 저장소.
 *
 * 2026-09-24 부터 이 저장소는 통합 테이블 `model_assignments`(config/model-slots 슬롯)를 감싸는 **어댑터**다 —
 * role 은 ROLE_SLOT 으로 슬롯에 대응하고, 돌려주는 row 는 요청한 role 이름을 그대로 유지한다.
 * 옛 user_model_roles 테이블은 더 읽지·쓰지 않는다(다음 배포에서 DROP — 2단계 삭제).
 *
 * 합쳐진 슬롯: review ↔ 'code'(기능 text.code 와 공유), research ↔ 'reasoning'(기능 text.reason 과 공유).
 *
 * services/model-role-resolver 의 UserModelRoleLookup 과 구조적으로 호환(getRoleModel).
 *
 * @see data/repositories/model-assignments-repo · config/model-slots · db/migrations/170_model_assignments.sql
 */
import { BaseRepository } from './base-repository';
import type { ModelRole } from '../../config/model-roles';
import { ROLE_SLOT, getModelSlot } from '../../config/model-slots';
import { ModelAssignmentsRepository } from './model-assignments-repo';

interface UserModelRoleRow {
    userId: string;
    role: ModelRole;
    fullModelId: string;
    updatedAt: Date;
}

export class UserModelRolesRepository extends BaseRepository {
    private get assignments(): ModelAssignmentsRepository {
        return new ModelAssignmentsRepository(this.pool);
    }

    /** resolver 폴백 1순위 조회 — 매핑 없으면 null */
    async getRoleModel(userId: string, role: ModelRole): Promise<string | null> {
        const slot = ROLE_SLOT[role];
        if (!slot) return null;
        const row = await this.assignments.get(userId, slot);
        return row?.fullId ?? null;
    }

    async listByUser(userId: string): Promise<UserModelRoleRow[]> {
        const rows = await this.assignments.listByScope(userId);
        // 슬롯 → 그 슬롯을 읽는 role(들). role 을 안 가진 슬롯(순수 기능)은 목록에서 빠진다.
        const out: UserModelRoleRow[] = [];
        for (const row of rows) {
            for (const role of getModelSlot(row.slot)?.roles ?? []) {
                out.push({ userId: row.scope, role, fullModelId: row.fullId, updatedAt: row.updatedAt });
            }
        }
        return out.sort((a, b) => a.role.localeCompare(b.role));
    }

    /**
     * 배정/변경 — 직전 값(previous)을 함께 반환한다(감사·소실 복원 근거).
     */
    async upsert(
        userId: string,
        role: ModelRole,
        fullModelId: string,
    ): Promise<{ mapping: UserModelRoleRow; previous: string | null }> {
        const slot = ROLE_SLOT[role];
        if (!slot) throw new Error(`role '${role}' 에 대응하는 슬롯이 없습니다`);
        const { row, previous } = await this.assignments.upsert(userId, slot, fullModelId, {});
        return {
            mapping: { userId: row.scope, role, fullModelId: row.fullId, updatedAt: row.updatedAt },
            previous,
        };
    }

    /** 매핑 해제 — 삭제된 직전 값(previous)을 함께 반환 */
    async delete(userId: string, role: ModelRole): Promise<{ deleted: boolean; previous: string | null }> {
        const slot = ROLE_SLOT[role];
        if (!slot) return { deleted: false, previous: null };
        return this.assignments.delete(userId, slot);
    }
}
