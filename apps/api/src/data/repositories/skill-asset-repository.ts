/**
 * skill_assets 저장소 — 스킬 번들 파일 (scripts/·references/·assets/).
 *
 * 배경: 외부 스킬 본문은 흔히 "see references/rules.md", "run scripts/check.py" 라고
 * 지시하는데 ingest 는 SKILL.md 한 파일만 가져와 **참조 대상이 존재하지 않았다**.
 * 이 테이블이 원본 바이트를 보존해 ① 본문의 파일 목록 안내 ② `load_skill(asset_paths)`
 * 열람에 쓰인다. ⚠️ ingest 는 현재 **텍스트 파일만** 넣는다 (GitFetcher 가 UTF-8 문자열만
 * 주므로 바이너리는 왕복에서 깨진다 — extension-components.isStorableAsset 참고).
 *
 * 스킬 삭제 시 ON DELETE CASCADE 로 함께 사라진다 (103).
 *
 * @module data/repositories/skill-asset-repository
 */
import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from './base-repository';

export interface SkillAssetRow {
    id: string;
    skill_id: string;
    rel_path: string;
    content_type: string;
    size_bytes: number;
    content: Buffer;
    created_at: Date;
}

export interface SkillAssetMeta {
    id: string;
    rel_path: string;
    content_type: string;
    size_bytes: number;
}

export interface InsertSkillAssetInput {
    skillId: string;
    relPath: string;
    contentType?: string;
    content: Buffer;
}

export class SkillAssetRepository extends BaseRepository {
    /** 번들 파일 저장 (같은 경로 재설치는 덮어씀 — uq_skill_assets_path). */
    async upsert(input: InsertSkillAssetInput): Promise<SkillAssetMeta> {
        const r = await this.query<SkillAssetMeta>(
            `INSERT INTO skill_assets (id, skill_id, rel_path, content_type, size_bytes, content)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (skill_id, rel_path) DO UPDATE
               SET content_type = EXCLUDED.content_type,
                   size_bytes   = EXCLUDED.size_bytes,
                   content      = EXCLUDED.content
             RETURNING id, rel_path, content_type, size_bytes`,
            [
                `skill-asset-${uuidv4()}`,
                input.skillId,
                input.relPath,
                input.contentType ?? 'text/plain',
                input.content.length,
                input.content,
            ],
        );
        return r.rows[0];
    }

    /** 메타만 조회 (본문 주입용 목록 — 바이트는 싣지 않는다). */
    async listMeta(skillId: string): Promise<SkillAssetMeta[]> {
        const r = await this.query<SkillAssetMeta>(
            `SELECT id, rel_path, content_type, size_bytes FROM skill_assets
              WHERE skill_id = $1 ORDER BY rel_path`,
            [skillId],
        );
        return r.rows;
    }

    /** 여러 스킬의 메타를 한 번에 (확장 상세·샌드박스 주입용). */
    async listMetaForSkills(skillIds: string[]): Promise<Array<SkillAssetMeta & { skill_id: string }>> {
        if (skillIds.length === 0) return [];
        const r = await this.query<SkillAssetMeta & { skill_id: string }>(
            `SELECT skill_id, id, rel_path, content_type, size_bytes FROM skill_assets
              WHERE skill_id = ANY($1::text[]) ORDER BY skill_id, rel_path`,
            [skillIds],
        );
        return r.rows;
    }

    /** 원본 바이트 포함 조회 (샌드박스 uploads/ 기록용). */
    async listWithContent(skillId: string): Promise<SkillAssetRow[]> {
        const r = await this.query<SkillAssetRow>(
            `SELECT * FROM skill_assets WHERE skill_id = $1 ORDER BY rel_path`,
            [skillId],
        );
        return r.rows;
    }

    /** 재설치 시 구 번들 정리 (스킬 자체는 유지). */
    async deleteForSkill(skillId: string): Promise<void> {
        await this.query('DELETE FROM skill_assets WHERE skill_id = $1', [skillId]);
    }
}
