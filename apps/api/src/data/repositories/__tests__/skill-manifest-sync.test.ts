import { buildManifestYaml, extractPreservedManifestYaml, skillContentChecksum, upsertSkillManifest, DEFAULT_SKILL_MANIFEST_VERSION, SKILL_VERSION_LATEST_ORDER_SQL } from '../skill-manifest-sync';
import { parseManifestTriggers } from '../../../agents/skill-triggers';

// 2026-08-29: createSkill/upsertSystemSkill/skill-creator 가 manifest 를 안 만들어 배정돼도
// 주입되지 않던 갭 — 모든 생성 경로가 이 헬퍼로 manifest 를 동반한다.
describe('skill-manifest-sync', () => {
    it('SKILL_VERSION_LATEST_ORDER_SQL — 숫자 토큰 int[] 우선, 정식 릴리스 > prerelease, 원문은 마지막 tiebreak (사전순 MAX(version) 대체)', () => {
        // 실제 정렬 결과는 운영 PG 에서 VALUES 로 검증: 10.0.0 > 2.0.0 > 1.36.0 > 1.30.0 > 1.4.0 > v1.2.3 > 1.0.0 > 1.0.0-beta > ''
        expect(SKILL_VERSION_LATEST_ORDER_SQL).toMatch(/^ARRAY\(SELECT m\[1\]::int FROM regexp_matches\(split_part\(version, '-', 1\), '\\d\+', 'g'\) AS m\) DESC, /);
        expect(SKILL_VERSION_LATEST_ORDER_SQL).toContain("(split_part(version, '-', 2) = '') DESC");
        expect(SKILL_VERSION_LATEST_ORDER_SQL.endsWith('version DESC')).toBe(true);
    });

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

    // 2026-09-11: 본문 수정이 yaml 을 3키로 다시 써서 triggers 가 사라지던 잠복 결함
    it('extractPreservedManifestYaml — 재생성 3키·fence 는 빼고 triggers·tool_bindings 등은 원문 그대로', () => {
        const yaml = [
            'name: presentation-designer', 'description: 발표자료 워크플로우', 'category: design', 'version: 1.0.3',
            'triggers:', '  - "발표자료"', '  - "PPT"',
            'tool_bindings:', '  - tool_name: "open-design::create_project"', '    mode: required',
        ].join('\n');
        expect(extractPreservedManifestYaml(yaml)).toBe([
            'version: 1.0.3', 'triggers:', '  - "발표자료"', '  - "PPT"',
            'tool_bindings:', '  - tool_name: "open-design::create_project"', '    mode: required',
        ].join('\n'));
    });

    it('extractPreservedManifestYaml — 3키뿐인 fence yaml·빈 값은 빈 문자열, 접힌 description 연속 줄도 제외', () => {
        expect(extractPreservedManifestYaml(buildManifestYaml({ name: 'n', description: 'd', category: 'ecc' }))).toBe('');
        expect(extractPreservedManifestYaml(null)).toBe('');
        expect(extractPreservedManifestYaml('description: >\n  긴 설명\n  둘째 줄\ntriggers: [a, b]')).toBe('triggers: [a, b]');
    });

    it('buildManifestYaml — preservedYaml 은 fence 안에 붙고, 닫는 fence 가 트리거로 잡히지 않는다', () => {
        const y = buildManifestYaml({ name: 'n', description: 'd', category: 'design', preservedYaml: 'triggers:\n  - "PPT"\n  - 발표' });
        expect(y).toBe('---\nname: n\ndescription: d\ncategory: design\ntriggers:\n  - "PPT"\n  - 발표\n---\n');
        expect(parseManifestTriggers(y)).toEqual(['PPT', '발표']);
    });
});
