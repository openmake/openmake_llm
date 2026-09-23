/**
 * 대화 폴더·태그 입력 검증 (F19.5, 157).
 *
 * @module schemas/conversation-organization.schema
 */
import { z } from 'zod';
import { CONVERSATION_LIMITS } from '../config/runtime-limits';
import { SCHEMA_LIMITS } from '../config/http-data-limits';

const { conversationOrg: CO } = SCHEMA_LIMITS;

/** PURE: 태그 정규화 — 앞뒤 공백·연속 공백 정리, 소문자, 앞의 # 제거, 빈 값·중복 제거, 길이·개수 상한 */
export function normalizeTags(tags: readonly string[]): string[] {
    const out: string[] = [];
    for (const raw of tags) {
        const t = String(raw).trim().replace(/^#+/, '').replace(/\s+/g, ' ').toLowerCase();
        if (!t || t.length > CONVERSATION_LIMITS.TAG_MAX_CHARS || out.includes(t)) continue;
        out.push(t);
        if (out.length >= CONVERSATION_LIMITS.MAX_TAGS_PER_SESSION) break;
    }
    return out;
}

const folderName = z.string().trim().min(1, '폴더 이름이 비어 있습니다').max(CONVERSATION_LIMITS.FOLDER_NAME_MAX_CHARS, `폴더 이름은 ${CONVERSATION_LIMITS.FOLDER_NAME_MAX_CHARS}자 이하입니다`);

export const createFolderSchema = z.object({ name: folderName });
export const updateFolderSchema = z.object({
    name: folderName.optional(),
    position: z.number().int().min(0).max(CO.POSITION_MAX).optional(),
}).refine((v) => v.name !== undefined || v.position !== undefined, { message: 'name 또는 position 이 필요합니다' });

/** 세션 정리 — folderId null 은 폴더에서 빼기, tags 는 정규화 후 저장 */
export const sessionOrganizationSchema = z.object({
    folderId: z.string().min(1).max(CO.FOLDER_ID_MAX).nullable().optional(),
    tags: z.array(z.string().max(CO.TAG_MAX)).max(CO.TAGS_COUNT_MAX).optional(),
});

/** 목록 필터 — folderId 'none' 은 미분류, tag 는 정규화한 1개 */
export function parseSessionListFilter(query: { folderId?: unknown; tag?: unknown }): { folderId?: string; tag?: string } {
    const folderId = typeof query.folderId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(query.folderId) ? query.folderId : undefined;
    const tag = typeof query.tag === 'string' ? normalizeTags([query.tag])[0] : undefined;
    return { ...(folderId ? { folderId } : {}), ...(tag ? { tag } : {}) };
}
