/**
 * 번들 빌더 라운드트립 — 내보낸 파일을 **우리 ingest 파서가 그대로 읽어야** 한다.
 * (내보내기만 되고 재설치가 안 되면 마켓플레이스에 올려도 쓸 수 없다.)
 */
import { buildPluginBundle, validatePluginName, asciiSlug } from './plugin-bundle-builder';
import { parseSkillFile } from '../../agents/manifest-validator';
import { validateExtensionManifest, parseMcpJsonFile, parseMarketplaceFile } from '../../agents/git-ingest/extension-manifest-validator';
import { agentFileToCustomAgent } from '../../agents/git-ingest/plugin-component-compat';

const skills = [
    { id: 's1', name: 'Nginx Log Error Analysis & Reporting', description: 'Nginx 로그 분석', content: '---\nname: old\n---\n**역할**\n분석한다.', category: 'technology', manifest_meta: { version: '1.0', tags: ['devops', 7] } },
    { id: 's2', name: 'CSV 결측치 분석', description: '', content: '# Role\n결측치를 찾는다.', category: null, manifest_meta: null },
];
const assets = [
    { skill_id: 's1', rel_path: 'scripts/parse.sh', content_type: 'text/x-sh', content: Buffer.from('#!/bin/sh\necho hi\n') },
    { skill_id: 's1', rel_path: '../escape.sh', content_type: null, content: Buffer.from('x') },
];
const agents = [{ id: 'a1', name: 'Security Lead', description: null, system_prompt: 'You are the Security Lead.', model: null }];
const mcp = [
    { id: 'm1', name: 'my-stdio', transport_type: 'stdio' as const, command: 'uvx', args: ['duckduckgo-mcp-server'], url: null, env_keys: ['API_KEY'] },
    { id: 'm2', name: 'my-remote', transport_type: 'streamable-http' as const, command: null, args: null, url: 'https://mcp.example.com/mcp', env_keys: [] },
];
const text = (files: { path: string; content: string | Buffer }[], p: string) => {
    const f = files.find((x) => x.path === p); if (!f) throw new Error('없음: ' + p);
    return typeof f.content === 'string' ? f.content : f.content.toString('utf8');
};

describe('buildPluginBundle 라운드트립', () => {
    const b = buildPluginBundle({ pluginName: 'my-devops-pack', description: 'DevOps 묶음', skills, assets, agents, mcpServers: mcp });

    it('plugin.json 이 우리 validator 를 통과한다', () => {
        const r = validateExtensionManifest(text(b.files, 'plugins/my-devops-pack/.claude-plugin/plugin.json'));
        expect(r.ok).toBe(true);
    });

    it('SKILL.md 는 정규 frontmatter 하나만 갖고 파서를 통과한다 (기존 frontmatter 제거·category 폴백·version 정규화)', () => {
        const md = text(b.files, 'plugins/my-devops-pack/skills/nginx-log-error-analysis-reporting/SKILL.md');
        expect(md.split('\n---\n').length).toBe(2);                 // frontmatter 한 벌
        const parsed = parseSkillFile(md);
        expect(parsed.frontmatter.name).toBe('Nginx Log Error Analysis & Reporting');
        expect(parsed.frontmatter.category).toBe('technology');
        expect(parsed.frontmatter.version).toBe('1.0.0');          // '1.0' 은 semver 아님 → 폴백
        expect((parsed.frontmatter as { tags?: unknown[] }).tags).toEqual(['devops']);
        expect(parsed.prompt_md).toContain('**역할**');
        expect(parsed.prompt_md).not.toContain('name: old');
        const csv = parseSkillFile(text(b.files, 'plugins/my-devops-pack/skills/csv/SKILL.md')); // ASCII 부분만 남는다
        expect(csv.frontmatter.category).toBe('general');           // null → 기본
        expect(csv.frontmatter.description).toBe('CSV 결측치 분석'); // 빈 설명 → 이름
    });

    it('번들 파일은 원본 바이트로 실리고 path traversal 은 건너뛴다', () => {
        expect(text(b.files, 'plugins/my-devops-pack/skills/nginx-log-error-analysis-reporting/scripts/parse.sh')).toContain('echo hi');
        expect(b.files.some((f) => f.path.includes('escape.sh'))).toBe(false);
    });

    it('agents/<slug>.md 는 Custom Agent 로 되읽힌다', () => {
        const a = agentFileToCustomAgent('agents/security-lead.md', text(b.files, 'plugins/my-devops-pack/agents/security-lead.md'));
        expect(a.name).toBe('Security Lead');
        expect(a.systemPrompt.trim()).toBe('You are the Security Lead.');
    });

    it('.mcp.json 은 env 값 없이 자리표시자만 담고 우리 파서를 통과한다', () => {
        const raw = text(b.files, 'plugins/my-devops-pack/.mcp.json');
        expect(raw).toContain('${API_KEY}');
        const r = parseMcpJsonFile(raw);
        expect(r.servers.map((s) => s.name).sort()).toEqual(['my-remote', 'my-stdio']);
        expect(r.servers.find((s) => s.name === 'my-remote')?.transportType).toBe('streamable-http');
    });

    it('marketplace 엔트리는 상대경로형이고 인덱스 파서를 통과한다', () => {
        expect(b.marketplaceEntry.source).toBe('./plugins/my-devops-pack');
        const idx = parseMarketplaceFile(JSON.stringify({ name: 'x', plugins: [b.marketplaceEntry] }));
        expect(idx.ok && idx.marketplace.plugins[0].path).toBe('plugins/my-devops-pack');
    });

    it('디렉토리 슬러그는 ASCII 만 — 비ASCII 는 버리고, 남는 게 없으면 이름 해시', () => {
        expect(asciiSlug('Nginx Log Error Analysis & Reporting', 'skill')).toBe('nginx-log-error-analysis-reporting');
        expect(asciiSlug('CSV 결측치 분석', 'skill')).toBe('csv');
        const k = asciiSlug('결측치 분석', 'skill');
        expect(k).toMatch(/^skill-[0-9a-f]{8}$/);
        expect(asciiSlug('결측치 분석', 'skill')).toBe(k);
        expect(b.files.every((f) => /^[\x20-\x7e]+$/.test(f.path))).toBe(true);
        expect(parseSkillFile(text(b.files, 'plugins/my-devops-pack/skills/csv/SKILL.md')).frontmatter.name).toBe('CSV 결측치 분석');
    });

    it('이름 규칙·빈 번들·상한을 거부한다', () => {
        expect(validatePluginName('My Pack')).not.toBeNull();
        expect(validatePluginName('my-pack')).toBeNull();
        expect(() => buildPluginBundle({ pluginName: 'empty', skills: [], assets: [], agents: [], mcpServers: [] })).toThrow(/없습니다/);
    });
});
