import {
    findExtensionManifestPath,
    discoverSkillPaths,
    discoverMarkdownComponents,
    findMcpConfigPath,
    hasInstallableComponents,
    resolveUnderRoot,
    synthesizedManifestPath,
    isSynthesizedManifestPath,
    rootOfSynthesizedPath,
} from '../extension-discovery';

// 카탈로그 판정과 설치가 공유하는 탐지 규칙 — 2026-08-29 드라이런(815건)에서 드러난 레이아웃을 고정한다.
describe('extension-discovery', () => {
    const e = (path: string) => ({ path });

    describe('findExtensionManifestPath', () => {
        it('우선순위: .claude-plugin/plugin.json > plugin.json > gemini-extension.json', () => {
            expect(findExtensionManifestPath([e('plugin.json'), e('.claude-plugin/plugin.json')], '')).toBe('.claude-plugin/plugin.json');
            expect(findExtensionManifestPath([e('p/plugin.json'), e('p/gemini-extension.json')], 'p/')).toBe('p/plugin.json');
            // Gemini CLI 확장 (openmake 마켓 code-review — 마켓 경로가 이걸 못 봐서 실패하던 건)
            expect(findExtensionManifestPath([e('gemini-extension.json'), e('skills/x/SKILL.md')], '')).toBe('gemini-extension.json');
            expect(findExtensionManifestPath([e('skills/x/SKILL.md')], '')).toBeUndefined();
        });
    });

    describe('합성 매니페스트 가상 경로', () => {
        it('root ↔ 가상 경로 왕복, 판별', () => {
            expect(synthesizedManifestPath('plugins/receipts/')).toBe('plugins/receipts/.claude-plugin/marketplace-entry.json');
            expect(isSynthesizedManifestPath('plugins/receipts/.claude-plugin/marketplace-entry.json')).toBe(true);
            expect(isSynthesizedManifestPath('.claude-plugin/marketplace-entry.json')).toBe(true);
            expect(isSynthesizedManifestPath('.claude-plugin/plugin.json')).toBe(false);
            expect(rootOfSynthesizedPath(synthesizedManifestPath('plugins/receipts/'))).toBe('plugins/receipts/');
            expect(rootOfSynthesizedPath(synthesizedManifestPath(''))).toBe('');
        });
    });

    describe('resolveUnderRoot', () => {
        it('./ 와 끝 / 제거, 루트 prefix 유지, .. 거부', () => {
            expect(resolveUnderRoot('p/', './skills/')).toBe('p/skills');
            expect(resolveUnderRoot('', './.mcp.json')).toBe('.mcp.json');
            expect(resolveUnderRoot('p/', '.')).toBe('p');
            expect(resolveUnderRoot('p/', '../outside')).toBeNull();
        });
    });

    describe('discoverSkillPaths', () => {
        it('기본 레이아웃 skills/<dir>/SKILL.md', () => {
            expect(discoverSkillPaths([e('skills/a/SKILL.md'), e('skills/a/b/SKILL.md'), e('README.md')], ''))
                .toEqual(['skills/a/SKILL.md']);
        });

        it('plugin.json skills 필드 — 디렉토리 직접(carbone ./carbone) · 컨테이너(mattpocock ./skills/engineering)', () => {
            const tree = [e('carbone/SKILL.md'), e('skills/engineering/tdd/SKILL.md'), e('skills/engineering/triage/SKILL.md')];
            expect(discoverSkillPaths(tree, '', ['./carbone'])).toEqual(['carbone/SKILL.md']);
            expect(discoverSkillPaths(tree, '', ['./skills/engineering']))
                .toEqual(['skills/engineering/tdd/SKILL.md', 'skills/engineering/triage/SKILL.md']);
            // mlflow: 루트 직하 디렉토리 배열
            expect(discoverSkillPaths([e('mlflow-agent/SKILL.md'), e('build-a-scorer/SKILL.md')], '', ['./mlflow-agent', './build-a-scorer']))
                .toEqual(['mlflow-agent/SKILL.md', 'build-a-scorer/SKILL.md']);
        });

        it('서브디렉토리 루트 + skills 필드 (dash0 ./claude/skills/)', () => {
            expect(discoverSkillPaths([e('claude/skills/dash0-configure/SKILL.md'), e('copilot/skills/dash0-configure/SKILL.md')], '', ['./claude/skills/']))
                .toEqual(['claude/skills/dash0-configure/SKILL.md']);
        });

        it('루트가 스킬 컨테이너 자체 (마켓 path=skills 인 amd/coursera) — 기본·필드 모두 없을 때만', () => {
            const tree = [e('skills/local-ai-use/SKILL.md'), e('skills/lemonade/SKILL.md')];
            expect(discoverSkillPaths(tree, 'skills/')).toEqual(['skills/local-ai-use/SKILL.md', 'skills/lemonade/SKILL.md']);
            // 기본 레이아웃이 있으면 컨테이너 폴백은 켜지지 않는다 (README 옆 무관한 SKILL.md 흡수 방지)
            expect(discoverSkillPaths([e('skills/a/SKILL.md'), e('other/SKILL.md')], '')).toEqual(['skills/a/SKILL.md']);
        });

        it('.. 경로 필드는 무시, 중복 제거', () => {
            expect(discoverSkillPaths([e('skills/a/SKILL.md')], '', ['../x', './skills'])).toEqual(['skills/a/SKILL.md']);
        });
    });

    describe('discoverMarkdownComponents', () => {
        it('디렉토리 기본 + 매니페스트 경로 필드(파일/디렉토리)', () => {
            const tree = [e('commands/a.md'), e('claude/commands/open-session.md'), e('claude/commands/x/nested.md')];
            expect(discoverMarkdownComponents(tree, '', 'commands')).toEqual(['commands/a.md']);
            expect(discoverMarkdownComponents(tree, '', 'commands', ['./claude/commands/open-session.md']))
                .toEqual(['commands/a.md', 'claude/commands/open-session.md']);
            expect(discoverMarkdownComponents(tree, '', 'commands', ['./claude/commands']))
                .toEqual(['commands/a.md', 'claude/commands/open-session.md', 'claude/commands/x/nested.md']);
        });
    });

    describe('findMcpConfigPath', () => {
        it('문자열 경로 우선, 없으면 루트 mcp.json/.mcp.json, 가리킨 파일이 없으면 undefined', () => {
            expect(findMcpConfigPath([e('.mcp.json')], '', './.mcp.json')).toBe('.mcp.json');
            expect(findMcpConfigPath([e('p/agents/claude/.mcp.json')], 'p/', './agents/claude/.mcp.json')).toBe('p/agents/claude/.mcp.json');
            expect(findMcpConfigPath([e('.mcp.json')], '', './missing.json')).toBeUndefined();   // kobiton 실사례
            expect(findMcpConfigPath([e('mcp.json'), e('.mcp.json')], '')).toBe('mcp.json');
            expect(findMcpConfigPath([e('README.md')], '')).toBeUndefined();
        });
    });

    describe('hasInstallableComponents (판정 = 설치 조건)', () => {
        const base = { mcpServers: [], skillPaths: [], commandPaths: [] };
        it('스킬·commands·agents·MCP 중 하나라도 있으면 true', () => {
            expect(hasInstallableComponents([e('skills/a/SKILL.md')], '', null)).toBe(true);
            expect(hasInstallableComponents([e('commands/a.md')], '', base)).toBe(true);
            expect(hasInstallableComponents([e('agents/a.md')], '', base)).toBe(true);
            expect(hasInstallableComponents([e('.mcp.json')], '', base)).toBe(true);
            expect(hasInstallableComponents([e('x.mcp.json')], '', { ...base, mcpServersPath: './x.mcp.json' })).toBe(true);
            expect(hasInstallableComponents([], '', { ...base, mcpServers: [{ name: 's', transportType: 'stdio', command: 'npx' }] })).toBe(true);
        });
        it('hooks/LSP 전용(langfuse·liquid-lsp)은 false', () => {
            expect(hasInstallableComponents([e('hooks/hooks.json'), e('.claude-plugin/plugin.json')], '', base)).toBe(false);
        });
    });
});
