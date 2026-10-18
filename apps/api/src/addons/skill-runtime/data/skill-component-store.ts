/**
 * 스킬 구성요소 저장 — Base 확장 플랫폼(git 설치·에이전트 설치·확장 수명주기·마켓 게시)이 쓰는 스킬 테이블 연산
 * (계약 `runtime-ports/component-stores.ts` `SkillComponentStore`, 2026-10-18).
 *
 * SQL 은 종전 Base 의 자리(agents/git-ingest/{git-ingest-service,agent-ingest-service,extension-components}.ts,
 * data/repositories/{user-extension-repository,marketplace-export-repository}.ts)에서 그대로 옮겼다. 호출자가 넘긴 DB 연결로
 * 나가고, 종전에 `BaseRepository` 를 거치던 연산(확장 수명주기·자산)은 같은 재시도 래퍼를 쓴다.
 * 데이터 모듈(`data-module.ts`)에 실려 꺼진 add-on 도 호스트가 불러온다 — 런타임에 기대지 말 것.
 *
 * @module addons/skill-runtime/data/skill-component-store
 */
import * as crypto from 'crypto';
import type { Pool } from 'pg';
import type { SkillComponentStore, StoreDb, ExportSkill, ExportSkillAsset, ImportedSkillRow } from '../../../runtime-ports/component-stores';
import { withRetry } from '../../../runtime-ports/db-access';
import { createLogger } from '../../../utils/logger';
import { SkillAssetRepository } from './skill-asset-repository';

const logger = createLogger('SkillComponentStore');

export function skillComponentStore(db: StoreDb): SkillComponentStore {
    /** 종전 BaseRepository.query 와 같은 재시도 래퍼 */
    const retried = <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[]) =>
        withRetry(() => db.query<T>(sql, params), { operation: sql.substring(0, 50) });

    return {
        async findRecentImportDraft(userId, promptHash, windowHours) {
            const r = await db.query<{ id: string }>(
                `SELECT id FROM agent_skills
               WHERE created_by = $1 AND status = 'draft'
                 AND manifest_meta->>'promptHash' = $2
                 AND created_at > NOW() - INTERVAL '${windowHours} hours'
               LIMIT 1`,
                [userId, promptHash],
            );
            return r.rows[0]?.id ?? null;
        },

        async countUserDrafts(userId) {
            const r = await db.query<{ count: string }>(
                `SELECT COUNT(*)::text AS count FROM agent_skills WHERE created_by=$1 AND status='draft'`,
                [userId],
            );
            return parseInt(r.rows[0]?.count ?? '0', 10);
        },

        async createImportedDraft(input) {
            await db.query(
                `INSERT INTO agent_skills
               (id, name, description, content, category, is_public, created_by, status, manifest_meta)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8::jsonb)`,
                [input.id, input.name, input.description, input.content, input.category, input.isPublic, input.createdBy, JSON.stringify(input.manifestMeta)],
            );
            // skill_manifests 동시 생성 — 시스템 프롬프트 주입의 SoT 는 buildManifestPrompt(skill_manifests JOIN)라, agent_skills 만
            // 만들면 manifest 스킬이 하나라도 활성일 때 legacy fallback 이 실행되지 않아 지정해도 조용히 누락된다(2026-08-16 실측).
            // status='active' 게이트가 draft 주입을 막으므로 승인 전 노출은 없다. 실패는 fail-soft — 개인 지정 union 이 안전망.
            try {
                await db.query(
                    `INSERT INTO skill_manifests
                   (id, version, manifest_yaml, prompt_md, checksum, signature, created_by, is_public, created_at)
                 VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, NOW())
                 ON CONFLICT (id, version) DO NOTHING`,
                    [input.id, input.manifest.version, input.manifest.rawYaml, input.content, input.manifest.checksum, input.createdBy, input.isPublic],
                );
            } catch (e) {
                logger.warn(`skill_manifests 생성 실패 (fail-soft, union 안전망 커버): ${input.id}`, e);
            }
        },

        async getImportedSkill(skillId) {
            const r = await db.query<ImportedSkillRow>(
                `SELECT id, name, description, category, content, manifest_meta FROM agent_skills WHERE id=$1`,
                [skillId],
            );
            return r.rows[0] ?? null;
        },

        async exists(skillId) {
            const r = await db.query<{ id: string }>(`SELECT id FROM agent_skills WHERE id=$1 LIMIT 1`, [skillId]);
            return r.rows.length > 0;
        },

        async assignToAgent(agentId, skillId, priority) {
            await db.query(
                `INSERT INTO agent_skill_assignments (agent_id, skill_id, priority, created_at)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (agent_id, skill_id) DO NOTHING`,
                [agentId, skillId, priority],
            );
        },

        async upsertAsset(input) {
            await new SkillAssetRepository(db as unknown as Pool).upsert(input);
        },

        async appendToContent(skillId, block) {
            const r = await db.query<{ content: string }>(
                `UPDATE agent_skills SET content = content || $2, updated_at = NOW()
              WHERE id = $1 RETURNING content`,
                [skillId, block],
            );
            const updated = r.rows[0]?.content;
            if (!updated) return;
            const checksum = crypto.createHash('sha256').update(updated).digest('hex');
            await db.query(`UPDATE skill_manifests SET prompt_md = $2, checksum = $3 WHERE id = $1`, [skillId, updated, checksum]);
        },

        async snapshotApproved(extensionId) {
            const r = await retried<{ name: string; agent_id: string | null; priority: number | null }>(
                `SELECT s.name, a.agent_id, a.priority
               FROM agent_skills s
               LEFT JOIN agent_skill_assignments a ON a.skill_id = s.id
              WHERE s.extension_id = $1 AND s.status = 'active'`,
                [extensionId],
            );
            const byName = new Map<string, Array<{ agentId: string; priority: number }>>();
            for (const row of r.rows) {
                const list = byName.get(row.name) ?? [];
                if (row.agent_id) list.push({ agentId: row.agent_id, priority: row.priority ?? 0 });
                byName.set(row.name, list);
            }
            return [...byName.entries()].map(([name, assignments]) => ({ name, assignments }));
        },

        async carryOverApprovals(installed, snapshot) {
            const prev = new Map(snapshot.map(s => [s.name, s.assignments]));
            const carried: string[] = [];
            for (const skill of installed) {
                const assignments = prev.get(skill.name);
                if (!assignments) continue;
                await retried(
                    `UPDATE agent_skills SET status='active', updated_at=$2 WHERE id=$1 AND status='draft'`,
                    [skill.skillId, new Date().toISOString()],
                );
                for (const a of assignments) {
                    await retried(
                        `INSERT INTO agent_skill_assignments (agent_id, skill_id, priority) VALUES ($1, $2, $3)
                     ON CONFLICT DO NOTHING`,
                        [a.agentId, skill.skillId, a.priority],
                    );
                }
                carried.push(skill.skillId);
            }
            return carried;
        },

        async link(extensionId, ids) {
            for (const skillId of ids) {
                await retried(`UPDATE agent_skills SET extension_id=$1 WHERE id=$2`, [extensionId, skillId]);
            }
        },

        async listLinked(extensionId) {
            const r = await retried<{ id: string; name: string; status: string }>(
                `SELECT id, name, status FROM agent_skills WHERE extension_id=$1 ORDER BY name`,
                [extensionId],
            );
            return r.rows;
        },

        async archiveLinked(extensionId, { unlink }) {
            // 배정도 함께 걷는다 — archived 스킬에 배정이 남으면 도구 바인딩이 계속 따라온다(2026-09-20).
            await retried(
                `DELETE FROM agent_skill_assignments WHERE skill_id IN (SELECT id FROM agent_skills WHERE extension_id=$1)`,
                [extensionId],
            );
            await retried(
                unlink
                    ? `UPDATE agent_skills SET status='archived', extension_id=NULL WHERE extension_id=$1`
                    : `UPDATE agent_skills SET status='archived' WHERE extension_id=$1`,
                [extensionId],
            );
        },

        async listExportCandidates(userId) {
            const r = await db.query<Omit<ExportSkill, 'content' | 'manifest_meta'>>(
                `SELECT id, name, description, category FROM agent_skills
                  WHERE created_by = $1 AND status = 'active' AND extension_id IS NULL ORDER BY updated_at DESC`, [userId]);
            return r.rows;
        },

        async getForExport(userId, ids) {
            if (ids.length === 0) return [];
            const r = await db.query<ExportSkill>(
                `SELECT id, name, description, content, category, manifest_meta FROM agent_skills
              WHERE created_by = $1 AND id = ANY($2::text[]) AND status = 'active' AND extension_id IS NULL`, [userId, [...ids]]);
            return r.rows;
        },

        async getAssetsForExport(skillIds) {
            if (skillIds.length === 0) return [];
            const r = await db.query<ExportSkillAsset>(
                `SELECT skill_id, rel_path, content_type, content FROM skill_assets WHERE skill_id = ANY($1::text[]) ORDER BY skill_id, rel_path`, [[...skillIds]]);
            return r.rows;
        },
    };
}
