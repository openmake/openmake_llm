/**
 * 스킬이 부르는 MCP 서버 부재 안내 (opt-in EXTENSION_MCP_DEPENDENCY_HINTS, 2026-11-28 ruflo 사례).
 * 판정은 런타임 별칭 해석과 같은 규칙, 제공 플러그인은 같은 저장소의 MCP 정의 파일에서 찾는다.
 */
import { buildMcpDependencyHints, mcpConfigServerKeys, providesKey, referencedMcpKeys, serverSatisfiesKey } from '../mcp-dependency-hint';

describe('PURE', () => {
    it('본문의 mcp__<키>__ 를 정규화해 모은다', () => {
        expect(referencedMcpKeys(['use `mcp__ruflo__memory_store` then mcp__ruflo__swarm_init', 'mcp__claude-flow__x'])).toEqual(['ruflo', 'claude_flow']);
    });
    it('서버 이름 충족 — 같은 이름·종전 접두 이름·충돌 접미사', () => {
        expect(serverSatisfiesKey(['ruflo'], 'ruflo')).toBe(true);
        expect(serverSatisfiesKey(['ruflo-core-ruflo'], 'ruflo')).toBe(true);
        expect(serverSatisfiesKey(['ruflo-core-ruflo-a1b2c3'], 'ruflo')).toBe(true);
        expect(serverSatisfiesKey(['rufloish', 'other'], 'ruflo')).toBe(false);
    });
    it('플러그인 표기 plugin_<플러그인>_<키> — 종전 이름·서버 키 이름 모두 충족 (ruflo 실측 표기)', () => {
        const key = referencedMcpKeys(['mcp__plugin_ruflo-core_ruflo__swarm_init'])[0];
        expect(key).toBe('plugin_ruflo_core_ruflo');
        expect(serverSatisfiesKey(['ruflo-core-ruflo'], key)).toBe(true);
        expect(serverSatisfiesKey(['ruflo'], key)).toBe(true);
        expect(serverSatisfiesKey(['other'], key)).toBe(false);
    });
    it('providesKey — 일반 표기·플러그인 표기(디렉터리 구성 이름)', () => {
        expect(providesKey('plugins/ruflo-core', 'ruflo', 'ruflo')).toBe(true);
        expect(providesKey('plugins/ruflo-core', 'ruflo', 'plugin_ruflo_core_ruflo')).toBe(true);
        expect(providesKey('plugins/ruflo-ai-team', 'ruflo', 'plugin_ruflo_core_ruflo')).toBe(false);
    });
    it('MCP 정의의 서버 키 — mcpServers 래핑·최상위 맵·깨진 JSON', () => {
        expect(mcpConfigServerKeys('{"mcpServers":{"ruflo":{"command":"node"}}}')).toEqual(['ruflo']);
        expect(mcpConfigServerKeys('{"ruflo-federation":{"type":"http"}}')).toEqual(['ruflo-federation']);
        expect(mcpConfigServerKeys('{bad')).toEqual([]);
    });
});

function ctx() {
    const files: Record<string, string> = {
        'plugins/ruflo-swarm/skills/s/SKILL.md': 'Call `mcp__plugin_ruflo-core_ruflo__swarm_init` and mcp__ruflo-federation__send.',
        'plugins/ruflo-core/.mcp.json': '{"mcpServers":{"ruflo":{"command":"node"}}}',
    };
    return {
        fetcher: { fetchFile: jest.fn(async (_o: string, _r: string, _s: string, p: string) => { if (p in files) return files[p]; throw new Error('404'); }) },
        owner: 'ruvnet', repo: 'ruflo', sha: 's', root: 'plugins/ruflo-swarm/',
        tree: { entries: ['plugins/ruflo-swarm/skills/s/SKILL.md', 'plugins/ruflo-core/.mcp.json'].map((path) => ({ path, size: 1 })) },
    } as never;
}

describe('buildMcpDependencyHints', () => {
    it('없는 서버는 안내 — 제공 플러그인을 찾으면 그 디렉터리, 못 찾으면 일반 안내', async () => {
        const hints = await buildMcpDependencyHints(ctx(), { skillPaths: ['plugins/ruflo-swarm/skills/s/SKILL.md'], serverNames: [] });
        expect(hints).toHaveLength(2);
        expect(hints[0]).toMatch(/^MCP_SERVER_MISSING: .*'plugin_ruflo-core_ruflo'.*'plugins\/ruflo-core'/);
        expect(hints[1]).toMatch(/^MCP_SERVER_MISSING: .*'ruflo-federation'.*제공하는 확장을 먼저 설치/);
    });
    it('이미 있는 서버(종전 이름 포함)는 안내하지 않는다', async () => {
        const hints = await buildMcpDependencyHints(ctx(), { skillPaths: ['plugins/ruflo-swarm/skills/s/SKILL.md'], serverNames: ['ruflo', 'ruflo-federation'] });
        expect(hints).toEqual([]);
    });
});
