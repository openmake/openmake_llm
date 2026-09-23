/**
 * 외부 호환 결과(P09) — 필수 도구 부재 실행 차단(T16)·인자 제한은 권한 확대 없이 검토 필요(T18)·allowed-tools 는 grant 아님·
 * `mcp__server__tool` 별칭(조사 ①)·본문 참조 번들 파일 수집의 경로 탈출 차단(조사 ②③).
 */
import { adaptSkillContent, extractDeclaredToolSpecs, mapClaudeTools, detectBodyToolNames, mcpAliasFor } from '../skill-compat';
import { referencedBundlePaths } from '../extension-components';
import { validateInstallableAddonManifest } from '../../../addon-host/manifest';

describe('compat report', () => {
    it('T16: 선언한 필수 도구에 대응이 없으면 본문 대신 실행 불가 안내 — 원문은 보존, 성공으로 보이지 않는다', () => {
        const promptMd = '1. `NotebookEdit` 로 셀을 고친다\n2. 결과를 저장한다';
        const r = adaptSkillContent({ frontmatter: { name: 'nb', description: 'd', 'allowed-tools': 'Read, NotebookEdit' }, promptMd });
        expect(r.report.requiredMissing).toEqual(['NotebookEdit']);
        expect(r.report.blockedReason).toMatch(/NotebookEdit/);
        expect(r.content).toMatch(/실행 불가/);
        expect(r.content).not.toContain('셀을 고친다');
        expect(r.compat?.originalPromptMd).toBe(promptMd);
        expect(r.notes.some(n => n.startsWith('실행 차단'))).toBe(true);
    });

    it('본문에만 언급된 미지원 도구는 차단하지 않고, 완료된 척하지 말라고 안내한다', () => {
        const r = adaptSkillContent({ frontmatter: { name: 'x', description: 'd' }, promptMd: 'Optionally use the `Monitor` tool.' });
        expect(r.report.blockedReason).toBeNull();
        expect(r.content).toMatch(/완료된 것처럼 말하지 마세요/);
    });

    it('T18: 인자 한정 표기는 이름만으로 넓히지 않고 검토 필요 — allowed-tools 는 권한 부여가 아니다', () => {
        const r = adaptSkillContent({ frontmatter: { name: 'g', description: 'd', 'allowed-tools': ['Bash(git:*)', 'Read'] }, promptMd: 'Run git status.' });
        expect(r.report.restrictions).toEqual([{ tool: 'Bash', args: 'git:*' }]);
        expect(r.report.reviewRequired).toBe(true);
        expect(r.report.permissionsGranted).toBe(false);
        expect(r.report.requestedTools).toEqual(['Bash(git:*)', 'Read']);
        expect(r.report.blockedReason).toBeNull();
        expect(r.notes.some(n => n.includes('강제할 수 없습니다'))).toBe(true);
        expect(extractDeclaredToolSpecs({ tools: 'Bash(npm run *), Glob' })).toEqual([{ tool: 'Bash', args: 'npm run *' }, { tool: 'Glob', args: null }]);
    });

    it('적응할 것이 없는 스킬은 무변경이고 보고서는 parsed', () => {
        const r = adaptSkillContent({ frontmatter: { name: 'p', description: 'd' }, promptMd: '평범한 본문' });
        expect(r.adapted).toBe(false);
        expect(r.report).toMatchObject({ supportLevel: 'parsed', reviewRequired: false, blockedReason: null });
    });

    it('mcp__server__tool 은 server::tool 로 대응하고 본문에서도 감지한다(조사 ①)', () => {
        expect(mcpAliasFor('mcp__apollo__search_people')).toBe('apollo::search_people');
        expect(mcpAliasFor('Read')).toBeNull();
        expect(detectBodyToolNames('Call mcp__apollo__enrich_org then summarise.')).toContain('mcp__apollo__enrich_org');
        expect(mapClaudeTools(['mcp__slack__post_message'])).toEqual([{ from: 'mcp__slack__post_message', to: 'slack::post_message' }]);
        const r = adaptSkillContent({ frontmatter: { name: 'a', description: 'd', 'allowed-tools': 'mcp__apollo__search_people' }, promptMd: 'x' });
        expect(r.content).toMatch(/`mcp__apollo__search_people` → `apollo::search_people`/);
        expect(r.report.blockedReason).toBeNull();
    });

    it('T17: 설치형 번들의 entry 선언은 종전처럼 거절', () => {
        const errors = validateInstallableAddonManifest(JSON.stringify({ id: 'x', name: 'x', version: '1.0.0', requires: { openmake: '>=1.0.0' }, scope: 'user', components: {}, entry: { runtime: 'boot#start' } }), '1.84.0');
        expect(errors.join(' ')).toMatch(/entry/);
    });
});

describe('referencedBundlePaths', () => {
    const entries = ['plug/skills/design/SKILL.md', 'plug/CONNECTORS.md', 'plug/skills/design/references/rules.md', 'plug/commands/review.md', 'plug/shared/style.md', 'secret.env', 'other/README.md']
        .map(path => ({ path }));

    it('../ 로 번들 루트 안 파일을 찾고 본문에 적힌 상대 경로로 돌려준다(조사 ②)', () => {
        const body = 'See [connectors](../../CONNECTORS.md) and `references/rules.md`. Missing ./nope.md';
        expect(referencedBundlePaths(body, 'plug/skills/design/SKILL.md', 'plug/', entries)).toEqual([
            { repoPath: 'plug/CONNECTORS.md', relPath: '../../CONNECTORS.md' },
            { repoPath: 'plug/skills/design/references/rules.md', relPath: 'references/rules.md' },
        ]);
    });

    it('commands 변환분도 참조 파일을 수집한다(조사 ③)', () => {
        expect(referencedBundlePaths('Follow ../shared/style.md strictly.', 'plug/commands/review.md', 'plug/', entries))
            .toEqual([{ repoPath: 'plug/shared/style.md', relPath: '../shared/style.md' }]);
    });

    it('번들 루트 밖·URL·절대 경로는 버린다(path traversal 차단)', () => {
        const body = '[x](../../../secret.env) [y](../../../other/README.md) [z](https://evil/x.md) [w](/etc/passwd)';
        expect(referencedBundlePaths(body, 'plug/skills/design/SKILL.md', 'plug/', entries)).toEqual([]);
    });
});
