import { normalizeTags, parseSessionListFilter, sessionOrganizationSchema, updateFolderSchema } from '../conversation-organization.schema';
import { sessionFilterClause } from '../../data/conversation-sessions';
import { CONVERSATION_LIMITS } from '../../config/runtime-limits';

describe('대화 폴더·태그 입력(157)', () => {
    it('normalizeTags — trim·# 제거·공백 접기·소문자·중복·빈값·길이·개수 상한', () => {
        expect(normalizeTags(['  #Work ', 'work', 'AI  Research', '', 'x'.repeat(CONVERSATION_LIMITS.TAG_MAX_CHARS + 1)])).toEqual(['work', 'ai research']);
        const many = Array.from({ length: 20 }, (_, i) => `t${i}`);
        expect(normalizeTags(many)).toHaveLength(CONVERSATION_LIMITS.MAX_TAGS_PER_SESSION);
    });

    it('parseSessionListFilter — 형식이 맞는 folderId·정규화한 tag 만', () => {
        expect(parseSessionListFilter({ folderId: 'none', tag: ' #E2E ' })).toEqual({ folderId: 'none', tag: 'e2e' });
        expect(parseSessionListFilter({ folderId: "x'; DROP", tag: '' })).toEqual({});
        expect(parseSessionListFilter({ folderId: ['a'] })).toEqual({});
    });

    it('sessionFilterClause — 파라미터 번호가 시작 번호부터 이어지고 값만 바인딩', () => {
        expect(sessionFilterClause({ folderId: 'f1', tag: 'ai' }, 3)).toEqual({ sql: ' AND cs.folder_id = $3 AND $4 = ANY(cs.tags)', params: ['f1', 'ai'] });
        expect(sessionFilterClause({ folderId: 'none', tag: 'ai' }, 4)).toEqual({ sql: ' AND cs.folder_id IS NULL AND $4 = ANY(cs.tags)', params: ['ai'] });
        expect(sessionFilterClause(undefined, 3)).toEqual({ sql: '', params: [] });
    });

    it('스키마 — folderId null 허용(미분류로), 폴더 수정은 name·position 중 하나 필요', () => {
        expect(sessionOrganizationSchema.safeParse({ folderId: null }).success).toBe(true);
        expect(sessionOrganizationSchema.safeParse({ folderId: '' }).success).toBe(false);
        expect(updateFolderSchema.safeParse({}).success).toBe(false);
        expect(updateFolderSchema.safeParse({ position: 2 }).success).toBe(true);
        expect(updateFolderSchema.safeParse({ name: '  ' }).success).toBe(false);
    });
});
