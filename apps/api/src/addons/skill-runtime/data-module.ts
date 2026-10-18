/**
 * 스킬 add-on 의 데이터 의무 — 꺼져 있어도 호스트가 불러온다(addon-host/data-data.ts). 런타임·매니저 없이 SQL 만 쓴다.
 * 종전 Base 의 사용자 삭제(data/user-manager.ts)·내보내기(controllers/export.controller.ts)에 있던 스킬 부분과, Base 확장
 * 플랫폼이 쓰는 스킬 구성요소 저장 연산(stores.skills)을 싣는다(2026-10-18).
 *
 * @module addons/skill-runtime/data-module
 */
import type { AddonDataModule } from '../../runtime-ports/addon-data';
import { getPool } from '../../runtime-ports/db-access';
import { skillComponentStore } from './data/skill-component-store';

export const skillDataModule: AddonDataModule = {
    stores: { skills: skillComponentStore },

    async exportUserData(userId) {
        const pool = getPool();
        const [manifests, skills] = await Promise.all([
            // skill_manifests 에는 updated_at 이 없다(#783 배포 후 failedCategories 로 드러난 옛 컬럼 참조).
            pool.query(
                `SELECT id, version, manifest_yaml, prompt_md, examples_md, checksum, is_public, created_by, created_at
                 FROM skill_manifests WHERE created_by = $1 ORDER BY created_at DESC`,
                [userId],
            ),
            pool.query(
                `SELECT id, name, description, content, category, is_public, created_by, created_at, updated_at
                 FROM agent_skills WHERE created_by = $1 ORDER BY created_at DESC`,
                [userId],
            ),
        ]);
        return { skillManifests: manifests.rows, agentSkills: skills.rows };
    },

    async onUserDelete(tx, userId) {
        await tx.query('DELETE FROM agent_skills WHERE created_by = $1', [userId]);
        // [GDPR Phase A Fix 1] skill_manifests.created_by FK 는 ON DELETE SET NULL — 사용자 삭제 시 manifest 가 system 소유
        // (created_by=NULL)로 바뀌어 다른 사용자에게 implicit grant 된다. SET NULL 이 발동하기 전에 is_public=false 를 강제해
        // 어떤 사용자에게도 노출되지 않는 행으로 남긴다(운영자가 처음부터 system 으로 만든 manifest 는 영향 없음).
        await tx.query('UPDATE skill_manifests SET is_public = FALSE WHERE created_by = $1 AND is_public = TRUE', [userId]);
    },
};
