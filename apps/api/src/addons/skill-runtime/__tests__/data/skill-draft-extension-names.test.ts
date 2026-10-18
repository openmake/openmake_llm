/**
 * draft 목록의 확장 이름 — `user_extensions` 는 Base 테이블이라 JOIN 대신 Base 데이터 포트로 채운다(2026-10-18).
 */
const namesByIds = jest.fn(async (ids: readonly string[]) => new Map(ids.filter((id) => id === 'ext-1').map((id) => [id, '확장 하나'] as [string, string])));
jest.mock('../../../../runtime-ports/base-data-port', () => ({ baseDataPort: { userExtensions: { namesByIds: (ids: readonly string[]) => namesByIds(ids) } } }));

import type { Pool } from 'pg';
import { SkillRepository } from '../../data/skill-repository';

const row = (id: string, extensionId: string | null) => ({
    id, name: id, description: '', content: '', category: 'general', is_public: false, created_by: 'u1',
    created_at: new Date('2026-10-18T00:00:00Z'), updated_at: new Date('2026-10-18T00:00:00Z'),
    source_repo: null, source_path: null, status: 'draft', manifest_meta: null, extension_id: extensionId,
});

describe('SkillRepository.listDrafts — 확장 이름', () => {
    it('확장 유래 draft 에만 포트가 준 이름을 싣고, 나머지는 그대로 둔다', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce({ rows: [{ total: '3' }] })
            .mockResolvedValueOnce({ rows: [row('a', 'ext-1'), row('b', null), row('c', 'ext-gone')] });
        const repo = new SkillRepository({ query } as unknown as Pool);
        const out = await repo.listDrafts({ target: 'user', userId: 'u1' });
        expect(namesByIds).toHaveBeenCalledWith(['ext-1', 'ext-gone']);
        expect(out.drafts.map((d) => [d.id, d.extensionId ?? null, d.extensionName ?? null])).toEqual([
            ['a', 'ext-1', '확장 하나'], ['b', null, null], ['c', 'ext-gone', null],
        ]);
        expect(out.total).toBe(3);
        for (const [sql] of query.mock.calls) expect(String(sql)).not.toContain('user_extensions');
    });
});
