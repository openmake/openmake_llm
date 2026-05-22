/**
 * AgentSkill row → object 매퍼 (skill-repository / skill-assignment-repository 공용).
 *
 * SkillRepository 의 private 메서드에서 추출 — 두 repo 가 같은 row shape 을
 * 다루므로 module-level helper 로 통합.
 *
 * @module data/repositories/skill-row-mapper
 */
import type { AgentSkill } from './skill-repository';

export function toStringValue(value: unknown, fallback: string = ''): string {
    if (typeof value === 'string') return value;
    return fallback;
}

export function toBooleanValue(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value;
    return fallback;
}

export function toDateValue(value: unknown): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') return new Date(value);
    return new Date(0);
}

export function rowToSkill(row: Record<string, unknown>): AgentSkill {
    const createdBy = row.created_by;
    const sourceRepo = row.source_repo;
    const sourcePath = row.source_path;
    const status = row.status;
    const manifestMeta = row.manifest_meta;

    return {
        id: toStringValue(row.id),
        name: toStringValue(row.name),
        description: toStringValue(row.description, ''),
        content: toStringValue(row.content),
        category: toStringValue(row.category, 'general'),
        isPublic: toBooleanValue(row.is_public, false),
        createdBy: typeof createdBy === 'string' ? createdBy : undefined,
        createdAt: toDateValue(row.created_at),
        updatedAt: toDateValue(row.updated_at),
        sourceRepo: typeof sourceRepo === 'string' ? sourceRepo : undefined,
        sourcePath: typeof sourcePath === 'string' ? sourcePath : undefined,
        status: status === 'draft' || status === 'active' || status === 'archived' ? status : undefined,
        manifestMeta: manifestMeta && typeof manifestMeta === 'object' ? manifestMeta as Record<string, unknown> : undefined,
    };
}
