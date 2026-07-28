/**
 * scanForMcpServerManifests — Phase 4 tree 탐지.
 */
import { scanForMcpServerManifests } from '../../../agents/git-ingest/repo-scanner';
import type { TreeEntry } from '../../../agents/git-ingest/git-fetcher';

const mkTree = (paths: string[]): TreeEntry[] =>
    paths.map((p, i) => ({ path: p, sha: `sha${i}`, size: 100, mode: '100644', type: 'blob' as const }));

describe('scanForMcpServerManifests', () => {
    test('root MCPSERVER.md 탐지', () => {
        const r = scanForMcpServerManifests(mkTree(['MCPSERVER.md', 'README.md', 'src/index.js']));
        expect(r).toHaveLength(1);
        expect(r[0].path).toBe('MCPSERVER.md');
    });

    test('*.mcpserver.md / *.mcp-server.md suffix 매칭 (대소문자 무관)', () => {
        const r = scanForMcpServerManifests(mkTree([
            'postgres.mcpserver.md',
            'redis.MCPSERVER.md',
            'github.mcp-server.md',
            'unrelated.md',
        ]));
        expect(r).toHaveLength(3);
    });

    test('mcp-servers/ 디렉토리 하위 *.md 탐지', () => {
        const r = scanForMcpServerManifests(mkTree([
            'mcp-servers/postgres.md',
            'mcp-servers/redis.md',
            'docs/guide.md',
        ]));
        expect(r.map((c: { path: string }) => c.path).sort()).toEqual([
            'mcp-servers/postgres.md',
            'mcp-servers/redis.md',
        ]);
    });

    test('explicitPath 지정 시 정확 일치만', () => {
        const tree = mkTree(['custom/path/MCPSERVER.md', 'MCPSERVER.md']);
        const r = scanForMcpServerManifests(tree, 'custom/path/MCPSERVER.md');
        expect(r).toHaveLength(1);
        expect(r[0].path).toBe('custom/path/MCPSERVER.md');
    });

    test('explicitPath 가 tree 에 없으면 빈 배열', () => {
        const r = scanForMcpServerManifests(mkTree(['MCPSERVER.md']), 'nonexistent.md');
        expect(r).toEqual([]);
    });

    test('SKILL.md / AGENT.md 와 혼합 시 MCP 만 추출', () => {
        const r = scanForMcpServerManifests(mkTree([
            'SKILL.md',
            'AGENT.md',
            'MCPSERVER.md',
            'mcp-servers/postgres.md',
        ]));
        expect(r.map((c: { path: string }) => c.path).sort()).toEqual(['MCPSERVER.md', 'mcp-servers/postgres.md']);
    });
});
