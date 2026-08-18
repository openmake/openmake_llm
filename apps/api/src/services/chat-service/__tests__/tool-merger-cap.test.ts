/**
 * user MCP 자동 노출 선정 — 개수 cap 과 스키마 바이트 예산의 이중 상한.
 *
 * 운영 실측(2026-08-19)에서 개수 cap 이 바이트 예산보다 먼저 걸려 정원을 낭비했다
 * (`46개 중 12개(8KB)` / 예산 16KB). cap 상향 후에도 바이트 상한이 실질 가드로
 * 남는지, 서버 언급 시 depth 우선이 유지되는지를 고정한다.
 */
import { selectUserMcpAutoOn } from '../tool-merger';

type Tool = { type: 'function'; function: { name: string; description: string; parameters: unknown } };

function makeTool(name: string, padding = 0): Tool {
    return {
        type: 'function',
        function: {
            name,
            description: 'x'.repeat(padding),
            parameters: { type: 'object', properties: {} },
        },
    };
}

function makeGroup(displayName: string, toolNames: string[], shortNames: string[] = []) {
    return { displayName, tools: toolNames, shortNames };
}

describe('selectUserMcpAutoOn', () => {
    it('cap 까지 채우되 서버마다 최소 1개는 대표된다', () => {
        const groups = [
            makeGroup('notebooklm', Array.from({ length: 39 }, (_, i) => `nb_${i}`)),
            makeGroup('mcp-kakao', Array.from({ length: 7 }, (_, i) => `kakao_${i}`)),
            makeGroup('open-design', Array.from({ length: 18 }, (_, i) => `od_${i}`)),
        ];
        const all = groups.flatMap(g => g.tools.map(n => makeTool(n))) as never;

        const picked = selectUserMcpAutoOn(all, groups as never, {}, 12, 100_000, '');
        expect(picked).toHaveLength(12);
        const names = picked.map(t => t.function.name);
        expect(names.some(n => n.startsWith('nb_'))).toBe(true);
        expect(names.some(n => n.startsWith('kakao_'))).toBe(true);
        expect(names.some(n => n.startsWith('od_'))).toBe(true);
    });

    it('cap 을 올리면 그만큼 더 노출된다 (예산이 넉넉할 때)', () => {
        const groups = [
            makeGroup('a', Array.from({ length: 30 }, (_, i) => `a_${i}`)),
            makeGroup('b', Array.from({ length: 30 }, (_, i) => `b_${i}`)),
        ];
        const all = groups.flatMap(g => g.tools.map(n => makeTool(n))) as never;

        expect(selectUserMcpAutoOn(all, groups as never, {}, 12, 100_000, '')).toHaveLength(12);
        expect(selectUserMcpAutoOn(all, groups as never, {}, 20, 100_000, '')).toHaveLength(20);
    });

    it('바이트 예산이 개수보다 빡빡하면 예산이 실질 가드가 된다', () => {
        const groups = [makeGroup('big', Array.from({ length: 30 }, (_, i) => `big_${i}`))];
        // 도구 하나당 ~1KB 로 부풀려 예산(5KB)이 먼저 걸리게 한다
        const all = groups[0].tools.map(n => makeTool(n, 1000)) as never;

        const picked = selectUserMcpAutoOn(all, groups as never, {}, 20, 5_000, '');
        expect(picked.length).toBeLessThan(20);
        expect(picked.length).toBeGreaterThan(0);
    });

    it('예산이 아주 작아도 최소 1개는 노출한다', () => {
        const groups = [makeGroup('big', ['big_0', 'big_1'])];
        const all = groups[0].tools.map(n => makeTool(n, 5000)) as never;

        expect(selectUserMcpAutoOn(all, groups as never, {}, 20, 10, '')).toHaveLength(1);
    });

    it('메시지가 서버를 언급하면 그 서버 도구를 우선 채운다', () => {
        const groups = [
            makeGroup('notebooklm', Array.from({ length: 10 }, (_, i) => `nb_${i}`)),
            makeGroup('mcp-kakao', Array.from({ length: 10 }, (_, i) => `kakao_${i}`)),
        ];
        const all = groups.flatMap(g => g.tools.map(n => makeTool(n))) as never;

        const picked = selectUserMcpAutoOn(all, groups as never, {}, 12, 100_000, 'notebooklm 으로 정리해줘');
        const nb = picked.filter(t => t.function.name.startsWith('nb_'));
        expect(nb).toHaveLength(10); // 참조 서버는 전부 우선
    });

    it('명시적으로 끈 도구(enabledTools=false)는 제외된다', () => {
        const groups = [makeGroup('a', ['a_0', 'a_1', 'a_2'])];
        const all = groups[0].tools.map(n => makeTool(n)) as never;

        const picked = selectUserMcpAutoOn(all, groups as never, { a_1: false }, 20, 100_000, '');
        expect(picked.map(t => t.function.name)).toEqual(['a_0', 'a_2']);
    });
});
