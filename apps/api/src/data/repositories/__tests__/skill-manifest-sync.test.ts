import { buildManifestYaml, skillContentChecksum, upsertSkillManifest, DEFAULT_SKILL_MANIFEST_VERSION } from '../skill-manifest-sync';

// 2026-08-29: createSkill/upsertSystemSkill/skill-creator 가 manifest 를 안 만들어 배정돼도
// 주입되지 않던 갭 — 모든 생성 경로가 이 헬퍼로 manifest 를 동반한다.
describe('skill-manifest-sync', () => {
    it('buildManifestYaml — 022/111 과 같은 fence 형식, 개행은 공백으로, category 기본 general', () => {
        const y = buildManifestYaml({ name: 'API 설계', description: '첫 줄\n둘째 줄', category: undefined });
        expect(y).toBe('---\nname: API 설계\ndescription: 첫 줄 둘째 줄\ncategory: general\n---\n');
        // 소비처(buildManifestPrompt)가 읽는 멀티라인 정규식과 호환
        expect(/^name:\s*([^\n]+)/m.exec(y)?.[1]).toBe('API 설계');
        expect(/^category:\s*([^\n]+)/m.exec(y)?.[1]).toBe('general');
    });

    it('upsertSkillManifest — (id,version) 충돌 시 본문·yaml·checksum 갱신, 기본 version 1.0.0', async () => {
        const query = jest.fn().mockResolvedValue({ rows: [] });
        await upsertSkillManifest(query, { id: 's1', name: 'n', description: 'd', category: 'ecc', content: 'body', createdBy: 'u3', isPublic: false });
        expect(query).toHaveBeenCalledTimes(1);
        const [sql, params] = query.mock.calls[0];
        expect(String(sql)).toContain('INSERT INTO skill_manifests');
        expect(String(sql)).toContain('ON CONFLICT (id, version) DO UPDATE');
        expect(params).toEqual(['s1', DEFAULT_SKILL_MANIFEST_VERSION, buildManifestYaml({ name: 'n', description: 'd', category: 'ecc' }), 'body', skillContentChecksum('body'), 'u3', false]);
        expect(skillContentChecksum('body')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('version 을 주면 그 버전을 갱신 (updateSkill 이 최신 version 을 넘긴다)', async () => {
        const query = jest.fn().mockResolvedValue({ rows: [] });
        await upsertSkillManifest(query, { id: 's1', name: 'n', content: 'c', version: '2.0.0' });
        expect(query.mock.calls[0][1][1]).toBe('2.0.0');
        expect(query.mock.calls[0][1][5]).toBeNull();
        expect(query.mock.calls[0][1][6]).toBe(false);
    });
});
