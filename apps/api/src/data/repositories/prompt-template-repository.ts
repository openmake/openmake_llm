/**
 * @module data/repositories/prompt-template-repository
 * @description `prompt_templates` / `prompt_template_versions` 테이블 데이터 접근 계층
 *
 * Phase 2.5 Prompt DB Registry 1단계 — 데이터 계층만 제공.
 * Admin UI / 핫스왑 / ChatService 통합은 별도 PR.
 *
 * 시맨틱 (createVersion):
 *  - prompt_template_versions에 새 version 번호로 NEW 콘텐츠 INSERT
 *  - prompt_templates 메인 행을 동일 콘텐츠 + 버전으로 UPDATE
 *  - 두 작업은 단일 트랜잭션 (BEGIN/COMMIT/ROLLBACK)
 *  - is_active=TRUE 유지 (활성 버전 = 메인 행 = 최신 versions row)
 *
 * SQL: db/migrations/013_prompt_templates.sql
 */
import { PoolClient } from 'pg';
import { BaseRepository } from './base-repository';
import type {
    CreatePromptTemplateInput,
    CreateVersionInput,
    PromptTemplate,
    PromptTemplateVersion
} from '../models/prompt-template.types';

interface PromptTemplateRow {
    id: string;
    name: string;
    category: string;
    content: string;
    language: string;
    version: number;
    is_active: boolean;
    created_at: Date | string;
    updated_at: Date | string;
}

interface PromptTemplateVersionRow {
    id: string;
    template_id: string;
    version: number;
    content: string;
    changed_by: string | null;
    changed_at: Date | string;
    change_reason: string | null;
}

export class PromptTemplateRepository extends BaseRepository {
    /**
     * 활성 템플릿을 name으로 조회.
     * 인덱스: idx_prompt_templates_name_active (partial)
     */
    async findActiveByName(name: string): Promise<PromptTemplate | null> {
        const result = await this.query<PromptTemplateRow>(
            `SELECT id, name, category, content, language, version, is_active,
                    created_at, updated_at
             FROM prompt_templates
             WHERE name = $1 AND is_active = TRUE
             LIMIT 1`,
            [name]
        );
        const row = result.rows[0];
        return row ? this.rowToTemplate(row) : null;
    }

    /**
     * 활성 템플릿 ID 조회 (단순 룩업)
     */
    async findIdByName(name: string): Promise<string | null> {
        const result = await this.query<{ id: string }>(
            `SELECT id FROM prompt_templates WHERE name = $1 LIMIT 1`,
            [name]
        );
        return result.rows[0]?.id ?? null;
    }

    /**
     * 카테고리별 활성 템플릿 목록.
     * 인덱스: idx_prompt_templates_category (partial)
     */
    async listByCategory(category: string): Promise<PromptTemplate[]> {
        const result = await this.query<PromptTemplateRow>(
            `SELECT id, name, category, content, language, version, is_active,
                    created_at, updated_at
             FROM prompt_templates
             WHERE category = $1 AND is_active = TRUE
             ORDER BY name ASC`,
            [category]
        );
        return result.rows.map((r) => this.rowToTemplate(r));
    }

    /**
     * ID로 활성 여부 무관 단건 조회 (관리/롤백용).
     */
    async findById(id: string): Promise<PromptTemplate | null> {
        const result = await this.query<PromptTemplateRow>(
            `SELECT id, name, category, content, language, version, is_active,
                    created_at, updated_at
             FROM prompt_templates
             WHERE id = $1
             LIMIT 1`,
            [id]
        );
        const row = result.rows[0];
        return row ? this.rowToTemplate(row) : null;
    }

    /**
     * 신규 템플릿 + 초기 버전(v1) 생성.
     * 트랜잭션: prompt_templates INSERT + prompt_template_versions INSERT(v1)
     */
    async createTemplate(input: CreatePromptTemplateInput): Promise<PromptTemplate> {
        return this.withTransaction(async (client) => {
            const insertTpl = await client.query<PromptTemplateRow>(
                `INSERT INTO prompt_templates (name, category, content, language, version, is_active)
                 VALUES ($1, $2, $3, $4, 1, TRUE)
                 RETURNING id, name, category, content, language, version, is_active,
                           created_at, updated_at`,
                [
                    input.name,
                    input.category ?? 'system',
                    input.content,
                    input.language ?? 'ko'
                ]
            );
            const tpl = insertTpl.rows[0];

            await client.query(
                `INSERT INTO prompt_template_versions
                    (template_id, version, content, changed_by, change_reason)
                 VALUES ($1, 1, $2, $3, $4)`,
                [
                    tpl.id,
                    input.content,
                    input.changedBy ?? null,
                    input.changeReason ?? null
                ]
            );

            return this.rowToTemplate(tpl);
        });
    }

    /**
     * 새 버전 생성 + 활성화.
     *
     * 시맨틱 (옵션 A):
     *  1) FOR UPDATE로 메인 행 락 (현재 version 읽기)
     *  2) prompt_template_versions에 (template_id, version+1, NEW content) INSERT
     *  3) prompt_templates 메인 행 UPDATE: content = NEW, version = version+1, is_active = TRUE
     *  4) 단일 트랜잭션
     *
     * @returns 갱신된 메인 템플릿
     * @throws 템플릿이 없으면 Error
     */
    async createVersion(input: CreateVersionInput): Promise<PromptTemplate> {
        return this.withTransaction(async (client) => {
            const lockRes = await client.query<{ version: number }>(
                `SELECT version FROM prompt_templates WHERE id = $1 FOR UPDATE`,
                [input.templateId]
            );
            const current = lockRes.rows[0];
            if (!current) {
                throw new Error(`PromptTemplate not found: ${input.templateId}`);
            }
            const nextVersion = current.version + 1;

            await client.query(
                `INSERT INTO prompt_template_versions
                    (template_id, version, content, changed_by, change_reason)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    input.templateId,
                    nextVersion,
                    input.content,
                    input.changedBy ?? null,
                    input.changeReason ?? null
                ]
            );

            const updateRes = await client.query<PromptTemplateRow>(
                `UPDATE prompt_templates
                 SET content = $1, version = $2, is_active = TRUE
                 WHERE id = $3
                 RETURNING id, name, category, content, language, version, is_active,
                           created_at, updated_at`,
                [input.content, nextVersion, input.templateId]
            );

            return this.rowToTemplate(updateRes.rows[0]);
        });
    }

    /**
     * 템플릿의 버전 히스토리 조회 (최신 우선).
     */
    async listVersions(templateId: string, limit: number = 50): Promise<PromptTemplateVersion[]> {
        const safeLimit = Math.min(Math.max(1, limit), 500);
        const result = await this.query<PromptTemplateVersionRow>(
            `SELECT id, template_id, version, content, changed_by, changed_at, change_reason
             FROM prompt_template_versions
             WHERE template_id = $1
             ORDER BY version DESC
             LIMIT $2`,
            [templateId, safeLimit]
        );
        return result.rows.map((r) => this.rowToVersion(r));
    }

    /**
     * 템플릿 활성 상태 토글 (소프트 비활성화 / 재활성화).
     * 핫스왑 PR에서 사용 예정 — 데이터 계층만 노출.
     */
    async setActive(id: string, isActive: boolean): Promise<boolean> {
        const result = await this.query(
            `UPDATE prompt_templates SET is_active = $1 WHERE id = $2`,
            [isActive, id]
        );
        return (result.rowCount ?? 0) > 0;
    }

    // ── 내부 헬퍼 ────────────────────────────────────────────

    /**
     * 트랜잭션 헬퍼 — pool.connect() + BEGIN/COMMIT/ROLLBACK + release.
     * BaseRepository.query()는 단발 쿼리이므로 다중 쿼리 트랜잭션은
     * 수동 PoolClient 관리가 필요하다.
     */
    private async withTransaction<T>(
        run: (client: PoolClient) => Promise<T>
    ): Promise<T> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await run(client);
            await client.query('COMMIT');
            return result;
        } catch (err) {
            try {
                await client.query('ROLLBACK');
            } catch {
                /* swallow rollback error to surface original */
            }
            throw err;
        } finally {
            client.release();
        }
    }

    private rowToTemplate(row: PromptTemplateRow): PromptTemplate {
        return {
            id: row.id,
            name: row.name,
            category: row.category,
            content: row.content,
            language: row.language,
            version: row.version,
            is_active: !!row.is_active,
            created_at: this.toIsoString(row.created_at),
            updated_at: this.toIsoString(row.updated_at)
        };
    }

    private rowToVersion(row: PromptTemplateVersionRow): PromptTemplateVersion {
        return {
            id: row.id,
            template_id: row.template_id,
            version: row.version,
            content: row.content,
            changed_by: row.changed_by,
            changed_at: this.toIsoString(row.changed_at),
            change_reason: row.change_reason
        };
    }

    private toIsoString(value: Date | string): string {
        if (value instanceof Date) return value.toISOString();
        return String(value);
    }
}
