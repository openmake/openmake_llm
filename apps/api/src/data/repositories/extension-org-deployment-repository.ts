/**
 * 조직 확장 배포 모드 저장소 (마켓플레이스 계획 v3.7 §8-1, 208·209).
 *
 * 표:
 *   organization_groups / organization_group_members (208) — 조직 내 그룹과 그 멤버(조직 멤버만, 복합 FK)
 *   extension_org_deployments (209)   — 조직 공개 항목의 배포 기본값(행 없음 = default_off)
 *   extension_org_group_modes (209)   — 그룹별 덮어쓰기
 *   extension_org_member_installs (209) — 조정의 멤버별 설치 기록(claim 으로 한 번만 설치)
 *
 * 해석(그룹 덮어쓰기 > 기본값, 여러 그룹이면 가장 강한 값)은 여기서 하지 않는다 — 재료(item_mode·group_modes)만
 * 돌려주고 판정은 config/extension-org-deployment `resolveDeploymentMode` 한 곳이 한다.
 * 이 저장소는 플래그 EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED 가 켜진 경로에서만 쓰인다.
 *
 * @module data/repositories/extension-org-deployment-repository
 */
import { BaseRepository } from './base-repository';
import type { UserExtensionRow } from './user-extension-repository';
import type { DeploymentMode } from '../../config/extension-org-deployment';

export interface OrgGroupRow {
    id: string;
    org_id: string;
    name: string;
    created_by: string | null;
    created_at: Date;
    updated_at: Date;
    member_ids: string[];
}

/** 관리 화면용 — 조직에 공개된 항목과 그 배포 설정 */
export interface OrgDeploymentItemRow {
    extension_id: string;
    name: string;
    version: string;
    description: string | null;
    owner_id: string;
    /** 항목 기본값(행 없음 = default_off) */
    mode: DeploymentMode;
    /** group_id → 덮어쓰기 값 (이 조직의 그룹만) */
    group_modes: Record<string, DeploymentMode>;
    /** 이 조직에서 자동 설치가 끝난 멤버 수 */
    installed_count: number;
}

/** 멤버 한 명의 해석 재료 — 조직 공개 원본 행 + 기본값 + 그 멤버가 속한 그룹들의 덮어쓰기 */
export interface MemberDeploymentInputRow extends UserExtensionRow {
    item_mode: DeploymentMode | null;
    group_modes: DeploymentMode[];
}

export type MemberInstallState = 'installing' | 'installed' | 'user_removed' | 'failed';

export interface MemberInstallRow {
    source_extension_id: string;
    user_id: string;
    org_id: string;
    installed_extension_id: string | null;
    state: MemberInstallState;
    attempts: number;
    last_error: string | null;
    created_at: Date;
    updated_at: Date;
}

export interface ClaimThresholds {
    failedRetryMs: number;
    maxAttempts: number;
    installingStaleMs: number;
}

export class ExtensionOrgDeploymentRepository extends BaseRepository {
    // ── 그룹 (208) ─────────────────────────────────────────────

    async listGroups(orgId: string): Promise<OrgGroupRow[]> {
        const r = await this.query<OrgGroupRow>(
            `SELECT g.id, g.org_id, g.name, g.created_by, g.created_at, g.updated_at,
                    COALESCE(array_agg(m.user_id ORDER BY m.user_id) FILTER (WHERE m.user_id IS NOT NULL), '{}') AS member_ids
               FROM organization_groups g
               LEFT JOIN organization_group_members m ON m.group_id = g.id
              WHERE g.org_id = $1
              GROUP BY g.id
              ORDER BY g.name`,
            [orgId]
        );
        return r.rows;
    }

    async countGroups(orgId: string): Promise<number> {
        const r = await this.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM organization_groups WHERE org_id = $1`, [orgId]);
        return parseInt(r.rows[0]?.n ?? '0', 10);
    }

    /** 그룹의 조직 — 없으면 null (다른 조직 그룹 조작 판정용) */
    async getGroupOrg(groupId: string): Promise<string | null> {
        const r = await this.query<{ org_id: string }>(`SELECT org_id FROM organization_groups WHERE id = $1`, [groupId]);
        return r.rows[0]?.org_id ?? null;
    }

    async createGroup(id: string, orgId: string, name: string, createdBy: string): Promise<OrgGroupRow> {
        const r = await this.query<OrgGroupRow>(
            `INSERT INTO organization_groups (id, org_id, name, created_by)
             VALUES ($1, $2, $3, $4)
             RETURNING id, org_id, name, created_by, created_at, updated_at, '{}'::text[] AS member_ids`,
            [id, orgId, name, createdBy]
        );
        return r.rows[0];
    }

    async renameGroup(orgId: string, groupId: string, name: string): Promise<boolean> {
        const r = await this.query(
            `UPDATE organization_groups SET name = $3, updated_at = NOW() WHERE id = $2 AND org_id = $1`,
            [orgId, groupId, name]
        );
        return (r.rowCount ?? 0) > 0;
    }

    async deleteGroup(orgId: string, groupId: string): Promise<boolean> {
        const r = await this.query(`DELETE FROM organization_groups WHERE id = $2 AND org_id = $1`, [orgId, groupId]);
        return (r.rowCount ?? 0) > 0;
    }

    /** 멤버 추가 — 조직 멤버가 아니면 FK(23503) 로 실패한다. 이미 있으면 그대로(멱등) */
    async addGroupMember(orgId: string, groupId: string, userId: string): Promise<void> {
        await this.query(
            `INSERT INTO organization_group_members (group_id, org_id, user_id) VALUES ($2, $1, $3)
             ON CONFLICT (group_id, user_id) DO NOTHING`,
            [orgId, groupId, userId]
        );
    }

    async removeGroupMember(orgId: string, groupId: string, userId: string): Promise<boolean> {
        const r = await this.query(
            `DELETE FROM organization_group_members WHERE org_id = $1 AND group_id = $2 AND user_id = $3`,
            [orgId, groupId, userId]
        );
        return (r.rowCount ?? 0) > 0;
    }

    /** 관리 화면의 멤버 선택지 — 조직 멤버와 표시 이름(username) */
    async listOrgMembers(orgId: string): Promise<Array<{ user_id: string; username: string; role: string }>> {
        const r = await this.query<{ user_id: string; username: string; role: string }>(
            `SELECT om.user_id, u.username, om.role
               FROM organization_members om JOIN users u ON u.id = om.user_id
              WHERE om.org_id = $1
              ORDER BY u.username, om.user_id`,
            [orgId]
        );
        return r.rows;
    }

    // ── 배포 모드 (209) ─────────────────────────────────────────

    /** 조직에 공개된 active 항목과 기본값·그룹 덮어쓰기·설치 수 */
    async listOrgItems(orgId: string): Promise<OrgDeploymentItemRow[]> {
        const r = await this.query<OrgDeploymentItemRow & { installed_count: string | number }>(
            `SELECT ue.id AS extension_id, ue.name, ue.version, ue.description, ue.user_id AS owner_id,
                    COALESCE(d.mode, 'default_off') AS mode,
                    COALESCE((SELECT jsonb_object_agg(gm.group_id, gm.mode)
                                FROM extension_org_group_modes gm
                                JOIN organization_groups g ON g.id = gm.group_id AND g.org_id = $1
                               WHERE gm.extension_id = ue.id), '{}'::jsonb) AS group_modes,
                    (SELECT COUNT(*) FROM extension_org_member_installs i
                      WHERE i.source_extension_id = ue.id AND i.org_id = $1 AND i.state = 'installed') AS installed_count
               FROM user_extensions ue
               LEFT JOIN extension_org_deployments d ON d.extension_id = ue.id AND d.org_id = $1
              WHERE ue.status = 'active' AND ue.visibility = 'organization' AND ue.org_id = $1
              ORDER BY ue.name, ue.id`,
            [orgId]
        );
        return r.rows.map((row) => ({ ...row, installed_count: Number(row.installed_count) }));
    }

    /** 항목의 공개 상태 — 모드 저장 전 "이 조직에 공개된 active 항목인가" 판정 */
    async getItemScope(extensionId: string): Promise<{ org_id: string | null; visibility: string; status: string } | null> {
        const r = await this.query<{ org_id: string | null; visibility: string; status: string }>(
            `SELECT org_id, visibility, status FROM user_extensions WHERE id = $1`,
            [extensionId]
        );
        return r.rows[0] ?? null;
    }

    /** 항목 기본값 저장 — 실패 재시도 상한에 걸린 멤버 설치도 다시 시도하게 시도 횟수를 비운다(관리자 조치) */
    async setItemMode(extensionId: string, orgId: string, mode: DeploymentMode, updatedBy: string): Promise<void> {
        await this.query(
            `INSERT INTO extension_org_deployments (extension_id, org_id, mode, updated_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (extension_id, org_id) DO UPDATE SET mode = EXCLUDED.mode, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
            [extensionId, orgId, mode, updatedBy]
        );
        await this.resetFailedAttempts(extensionId);
    }

    /** 그룹 덮어쓰기 저장 — null 이면 덮어쓰기를 지운다(항목 기본값을 따른다) */
    async setGroupMode(extensionId: string, groupId: string, mode: DeploymentMode | null, updatedBy: string): Promise<void> {
        if (mode === null) {
            await this.query(`DELETE FROM extension_org_group_modes WHERE extension_id = $1 AND group_id = $2`, [extensionId, groupId]);
        } else {
            await this.query(
                `INSERT INTO extension_org_group_modes (extension_id, group_id, mode, updated_by)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (extension_id, group_id) DO UPDATE SET mode = EXCLUDED.mode, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
                [extensionId, groupId, mode, updatedBy]
            );
        }
        await this.resetFailedAttempts(extensionId);
    }

    private async resetFailedAttempts(extensionId: string): Promise<void> {
        await this.query(
            `UPDATE extension_org_member_installs SET attempts = 0
              WHERE source_extension_id = $1 AND state = 'failed'`,
            [extensionId]
        );
    }

    /**
     * 멤버 한 명의 해석 재료 — 조직(`orgId`)에 공개된 active 원본마다 기본값과 **그 멤버가 속한 그룹들**의 덮어쓰기.
     * 호출부가 멤버십(활성 조직)을 검증한 뒤 부른다.
     */
    async listMemberInputs(userId: string, orgId: string): Promise<MemberDeploymentInputRow[]> {
        const r = await this.query<MemberDeploymentInputRow>(
            `SELECT ue.*, d.mode AS item_mode,
                    COALESCE((SELECT array_agg(gm.mode ORDER BY gm.mode)
                                FROM extension_org_group_modes gm
                                JOIN organization_group_members m
                                  ON m.group_id = gm.group_id AND m.user_id = $1 AND m.org_id = $2
                               WHERE gm.extension_id = ue.id), '{}'::text[]) AS group_modes
               FROM user_extensions ue
               LEFT JOIN extension_org_deployments d ON d.extension_id = ue.id AND d.org_id = $2
              WHERE ue.status = 'active' AND ue.visibility = 'organization' AND ue.org_id = $2
              ORDER BY ue.created_at, ue.id`,
            [userId, orgId]
        );
        return r.rows;
    }

    /**
     * 주기 조정 대상 — 활성 조직(preferences.activeOrgId)이 그 조직인 멤버 중, 그 조직에 자동 설치 값(기본값 또는
     * 그 멤버 그룹의 덮어쓰기)이 하나라도 있는 (멤버, 조직). 멤버십이 실재하는 행만(organization_members 조인).
     */
    async listReconcileCandidates(limit: number, orgId: string | null = null): Promise<Array<{ user_id: string; org_id: string }>> {
        const r = await this.query<{ user_id: string; org_id: string }>(
            `SELECT om.user_id, om.org_id
               FROM organization_members om
               JOIN users u ON u.id = om.user_id AND u.preferences->>'activeOrgId' = om.org_id
              WHERE ($2::text IS NULL OR om.org_id = $2)
                AND (EXISTS (SELECT 1 FROM extension_org_deployments d
                              JOIN user_extensions ue ON ue.id = d.extension_id AND ue.status = 'active'
                                   AND ue.visibility = 'organization' AND ue.org_id = d.org_id
                             WHERE d.org_id = om.org_id AND d.mode <> 'default_off')
                 OR EXISTS (SELECT 1 FROM extension_org_group_modes gm
                              JOIN organization_group_members m ON m.group_id = gm.group_id
                                   AND m.user_id = om.user_id AND m.org_id = om.org_id
                              JOIN user_extensions ue ON ue.id = gm.extension_id AND ue.status = 'active'
                                   AND ue.visibility = 'organization' AND ue.org_id = om.org_id
                             WHERE gm.mode <> 'default_off'))
              ORDER BY om.org_id, om.user_id
              LIMIT $1`,
            [limit, orgId]
        );
        return r.rows;
    }

    // ── 멤버 설치 기록 (209) ─────────────────────────────────────

    /**
     * 설치 권리 잡기(claim) — 처음이면 'installing' 행을 만들고, 이미 있으면 다시 설치할 사유가 있을 때만 'installing' 으로 바꾼다.
     * 행을 돌려받은 쪽만 설치한다(두 조정이 겹쳐도 한 번 — 행 잠금으로 직렬화된다). 사유:
     *   failed        시도 횟수가 상한 아래이고 재시도 간격이 지났다(관리자가 모드를 다시 저장해 횟수가 0 이면 바로)
     *   installing    오래 잡힌 채(죽은 시도)
     *   user_removed  모드가 required 일 때만(default_on 은 멤버가 지운 것을 존중)
     *   installed     모드가 required 인데 설치본이 더 이상 active 가 아닐 때(다른 경로로 지워짐)
     */
    async claimInstall(
        sourceExtensionId: string,
        userId: string,
        orgId: string,
        mode: DeploymentMode,
        t: ClaimThresholds,
    ): Promise<MemberInstallRow | null> {
        const r = await this.query<MemberInstallRow>(
            `INSERT INTO extension_org_member_installs AS t (source_extension_id, user_id, org_id, state, attempts)
             VALUES ($1, $2, $3, 'installing', 1)
             ON CONFLICT (source_extension_id, user_id) DO UPDATE
                SET state = 'installing', org_id = EXCLUDED.org_id, last_error = NULL, updated_at = NOW(),
                    attempts = CASE WHEN t.state = 'failed' THEN t.attempts + 1 ELSE 1 END
              WHERE (t.state = 'failed' AND t.attempts < $5
                     AND (t.attempts = 0 OR t.updated_at < NOW() - ($6::text || ' milliseconds')::interval))
                 OR (t.state = 'installing' AND t.updated_at < NOW() - ($7::text || ' milliseconds')::interval)
                 OR ($4 = 'required' AND t.state = 'user_removed')
                 OR ($4 = 'required' AND t.state = 'installed'
                     AND NOT EXISTS (SELECT 1 FROM user_extensions x
                                      WHERE x.id = t.installed_extension_id AND x.status = 'active'))
             RETURNING *`,
            [sourceExtensionId, userId, orgId, mode, t.maxAttempts, String(t.failedRetryMs), String(t.installingStaleMs)]
        );
        return r.rows[0] ?? null;
    }

    async markInstalled(sourceExtensionId: string, userId: string, installedExtensionId: string): Promise<void> {
        await this.query(
            `UPDATE extension_org_member_installs
                SET state = 'installed', installed_extension_id = $3, last_error = NULL, attempts = 0, updated_at = NOW()
              WHERE source_extension_id = $1 AND user_id = $2 AND state = 'installing'`,
            [sourceExtensionId, userId, installedExtensionId]
        );
    }

    async markFailed(sourceExtensionId: string, userId: string, error: string): Promise<void> {
        await this.query(
            `UPDATE extension_org_member_installs
                SET state = 'failed', last_error = $3, updated_at = NOW()
              WHERE source_extension_id = $1 AND user_id = $2 AND state = 'installing'`,
            [sourceExtensionId, userId, error]
        );
    }

    /** 멤버가 지웠다 — default_on 은 다시 설치하지 않는다(required 는 claim 이 다시 잡는다) */
    async markUserRemoved(sourceExtensionId: string, userId: string): Promise<void> {
        await this.query(
            `UPDATE extension_org_member_installs SET state = 'user_removed', updated_at = NOW()
              WHERE source_extension_id = $1 AND user_id = $2`,
            [sourceExtensionId, userId]
        );
    }

    /** 멤버 설치본 → 기록 (제거 판정·목록 표시) */
    async findByInstalledExtension(installedExtensionId: string, userId: string): Promise<MemberInstallRow | null> {
        const r = await this.query<MemberInstallRow>(
            `SELECT * FROM extension_org_member_installs WHERE installed_extension_id = $1 AND user_id = $2 LIMIT 1`,
            [installedExtensionId, userId]
        );
        return r.rows[0] ?? null;
    }

    async listInstallsForUser(userId: string): Promise<MemberInstallRow[]> {
        const r = await this.query<MemberInstallRow>(
            `SELECT * FROM extension_org_member_installs WHERE user_id = $1 AND installed_extension_id IS NOT NULL`,
            [userId]
        );
        return r.rows;
    }
}
