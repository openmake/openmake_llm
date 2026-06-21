/**
 * Skill manifest → DB 트랜잭션 저장.
 *
 * 단일 트랜잭션으로 3 테이블 INSERT:
 *   - skill_manifests           (id, version, manifest_yaml, prompt_md, checksum, ...)
 *   - skill_tool_bindings       (manifest 의 tool_bindings 배열)
 *   - skill_mcp_bundles         (manifest 의 mcp_bundles 배열)
 *
 * 중복 처리 (P5-D8):
 *   - (id, version) 이 이미 존재하고 checksum 동일 → no-op, duplicate_checksum=true
 *   - (id, version) 이 이미 존재하고 checksum 다름 → 에러 (새 version 으로 업로드 요구)
 *
 * skill_id 유도:
 *   - manifest.name 의 slug + user prefix → `user-{userId}-{slug}`
 *   - (admin 의 시스템 skill 은 별도 importer 또는 직접 SQL — 본 importer 는 사용자 업로드 전용)
 *
 */
import type { Pool, PoolClient } from 'pg';
import type { SkillManifestFrontmatter } from '../schemas/skill-manifest.schema';
import { createLogger } from '../utils/logger';

const logger = createLogger('ManifestImporter');

export interface ImportInput {
    manifest: SkillManifestFrontmatter;
    prompt_md: string;
    raw_yaml: string;
    checksum: string;
    createdBy: string;
    isAdmin: boolean;
}

export interface ImportResult {
    skill_id: string;
    version: string;
    inserted: boolean;
    duplicate_checksum: boolean;
}

export class ManifestImporter {
    constructor(private pool: Pool) {}

    async import(input: ImportInput): Promise<ImportResult> {
        const skillId = this.deriveSkillId(input.manifest.name, input.createdBy);
        const isPublic = input.manifest.is_public && input.isAdmin;
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            const existing = await client.query<{ checksum: string }>(
                'SELECT checksum FROM skill_manifests WHERE id = $1 AND version = $2',
                [skillId, input.manifest.version],
            );
            if (existing.rowCount && existing.rowCount > 0) {
                const sameChecksum = existing.rows[0]?.checksum === input.checksum;
                await client.query('ROLLBACK');
                if (sameChecksum) {
                    return {
                        skill_id: skillId,
                        version: input.manifest.version,
                        inserted: false,
                        duplicate_checksum: true,
                    };
                }
                throw new Error(
                    `skill ${skillId} v${input.manifest.version} 이 이미 존재합니다 (checksum 다름). 새 version 으로 업로드하세요`,
                );
            }

            await client.query(
                `INSERT INTO skill_manifests
                 (id, version, manifest_yaml, prompt_md, checksum, signature, created_by, is_public, created_at)
                 VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, NOW())`,
                [
                    skillId,
                    input.manifest.version,
                    input.raw_yaml,
                    input.prompt_md,
                    input.checksum,
                    input.createdBy,
                    isPublic,
                ],
            );

            await this.insertBindings(client, skillId, input.manifest.version, input.manifest);
            await this.insertMcpBundles(client, skillId, input.manifest.version, input.manifest);

            // 업로드 사용자의 채팅에 자동으로 노출되도록 user:{userId} 가상 agent 에 할당.
            // agent_skills 테이블에는 skill 행이 없으므로 FK 우회를 위해 placeholder 행 INSERT
            // (skill-repository 의 user-assign 패턴 동등).
            // 참조: project_users_id_text 메모리 + system-prompt.buildManifestPrompt 의 JOIN 조건.
            const userAgentId = `user:${input.createdBy}`;
            await client.query(
                `INSERT INTO agent_skills (id, name, description, content, category, is_public, created_by, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
                 ON CONFLICT (id) DO NOTHING`,
                [
                    skillId,
                    input.manifest.name,
                    input.manifest.description,
                    input.prompt_md,
                    input.manifest.category,
                    isPublic,
                    input.createdBy,
                ],
            );
            await client.query(
                `INSERT INTO agent_skill_assignments (agent_id, skill_id, priority)
                 VALUES ($1, $2, 100)
                 ON CONFLICT DO NOTHING`,
                [userAgentId, skillId],
            );

            await client.query('COMMIT');
            logger.info(
                `manifest import 완료: ${skillId} v${input.manifest.version} ` +
                `(bindings=${input.manifest.tool_bindings.length}, bundles=${input.manifest.mcp_bundles.length})`,
            );
            return {
                skill_id: skillId,
                version: input.manifest.version,
                inserted: true,
                duplicate_checksum: false,
            };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    private deriveSkillId(name: string, createdBy: string): string {
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return `user-${createdBy}-${slug}`;
    }

    private async insertBindings(
        client: PoolClient,
        skillId: string,
        version: string,
        manifest: SkillManifestFrontmatter,
    ): Promise<void> {
        for (const binding of manifest.tool_bindings) {
            await client.query(
                `INSERT INTO skill_tool_bindings
                 (skill_id, skill_version, tool_name, binding_mode, args_schema_json)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    skillId,
                    version,
                    binding.tool_name,
                    binding.mode,
                    binding.args_schema ? JSON.stringify(binding.args_schema) : null,
                ],
            );
        }
    }

    private async insertMcpBundles(
        client: PoolClient,
        skillId: string,
        version: string,
        manifest: SkillManifestFrontmatter,
    ): Promise<void> {
        for (const bundle of manifest.mcp_bundles) {
            await client.query(
                `INSERT INTO skill_mcp_bundles
                 (skill_id, skill_version, server_name, server_config_json, lifecycle)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    skillId,
                    version,
                    bundle.server_name,
                    JSON.stringify(bundle.server_config),
                    bundle.lifecycle,
                ],
            );
        }
    }
}
