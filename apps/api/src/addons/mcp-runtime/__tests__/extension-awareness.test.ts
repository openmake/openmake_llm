/**
 * MCP-5 확장 인식 — 분류 순수 함수·플래그·fail-open 조회.
 */
import {
    KNOWN_MCP_EXTENSIONS,
    MCP_EXTENSION_AWARENESS_FLAG,
    catalogExtensionLookup,
    classifyDeclaredExtensions,
    declaredExtensionFields,
    providesSkills,
    serverExtensionLookup,
    type DeclaredExtensionSource,
} from '../extension-awareness';
import { mcpRuntimeContributions } from '../contributions';

const FLAG = MCP_EXTENSION_AWARENESS_FLAG;
afterEach(() => { delete process.env[FLAG]; });

function source(over: Partial<DeclaredExtensionSource> = {}): DeclaredExtensionSource & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        extensionsByServerIds: async (ids) => { calls.push(`server:${ids.join(',')}`); return new Map([['s1', [{ id: 'io.modelcontextprotocol/tasks' }]]]); },
        extensionsByCatalogTemplateIds: async (ids) => { calls.push(`catalog:${ids.join(',')}`); return new Map([['t1', [{ id: 'io.modelcontextprotocol/skills' }]]]); },
        ...over,
    };
}

describe('classifyDeclaredExtensions', () => {
    it('공식 확장 id 를 종류로 나누고 전부 "미지원(인식만)" 으로 둔다', () => {
        const out = classifyDeclaredExtensions([
            { id: 'io.modelcontextprotocol/ui', version: '2026-01-26' },
            { id: 'io.modelcontextprotocol/tasks' },
            { id: 'io.modelcontextprotocol/skills' },
        ]);
        expect(out.map(e => [e.id, e.kind, e.support])).toEqual([
            ['io.modelcontextprotocol/skills', 'skills', 'unsupported'],
            ['io.modelcontextprotocol/tasks', 'tasks', 'unsupported'],
            ['io.modelcontextprotocol/ui', 'apps', 'unsupported'],
        ]);
        expect(out.find(e => e.kind === 'apps')?.version).toBe('2026-01-26');
    });

    it('표에 없는 id 는 unknown/unrecognized, 중복·빈 값은 버린다', () => {
        expect(classifyDeclaredExtensions([{ id: 'com.example/x' }, { id: 'com.example/x' }, { id: '' }])).toEqual([
            { id: 'com.example/x', kind: 'unknown', support: 'unrecognized' },
        ]);
    });

    it('미선언·잘못된 입력이면 빈 배열(필드 없음)', () => {
        expect(classifyDeclaredExtensions(undefined)).toEqual([]);
        expect(classifyDeclaredExtensions([])).toEqual([]);
        expect(declaredExtensionFields([])).toEqual({});
        expect(declaredExtensionFields(null)).toEqual({});
    });

    it('Skills over MCP 선언 서버는 스킬 제공 서버로 판정된다', () => {
        expect(providesSkills(classifyDeclaredExtensions([{ id: 'io.modelcontextprotocol/skills' }]))).toBe(true);
        expect(providesSkills(classifyDeclaredExtensions([{ id: 'io.modelcontextprotocol/ui' }]))).toBe(false);
    });

    it('표의 id 는 전부 공식 io.modelcontextprotocol 네임스페이스다', () => {
        for (const id of Object.keys(KNOWN_MCP_EXTENSIONS)) expect(id.startsWith('io.modelcontextprotocol/')).toBe(true);
    });
});

describe('serverExtensionLookup / catalogExtensionLookup', () => {
    it('플래그 OFF 면 조회하지 않고 늘 빈 객체', async () => {
        const src = source();
        const f = await serverExtensionLookup(src, ['s1']);
        expect(f('s1')).toEqual({});
        expect(src.calls).toEqual([]);
    });

    it('플래그 ON 이면 선언 서버에만 필드, 미선언 서버는 빈 객체', async () => {
        process.env[FLAG] = 'true';
        const src = source();
        const f = await serverExtensionLookup(src, ['s1', 's2']);
        expect(f('s1')).toEqual({ declaredExtensions: [{ id: 'io.modelcontextprotocol/tasks', kind: 'tasks', support: 'unsupported' }] });
        expect(f('s2')).toEqual({});
        const c = await catalogExtensionLookup(src, ['t1']);
        expect(c('t1').declaredExtensions?.[0]).toMatchObject({ kind: 'skills' });
        expect(src.calls).toEqual(['server:s1,s2', 'catalog:t1']);
    });

    it('대상이 없으면 조회하지 않는다', async () => {
        process.env[FLAG] = 'true';
        const src = source();
        await serverExtensionLookup(src, []);
        expect(src.calls).toEqual([]);
    });

    it('조회 실패는 표시만 빠진다(fail-open)', async () => {
        process.env[FLAG] = 'true';
        const f = await serverExtensionLookup(source({ extensionsByServerIds: async () => { throw new Error('db'); } }), ['s1']);
        expect(f('s1')).toEqual({});
    });
});

describe('플래그 등록', () => {
    it('add-on 기여 설정에 MCP_EXTENSION_AWARENESS 가 실시간 boolean 으로 있다', () => {
        const entry = mcpRuntimeContributions.settings?.find(s => s.key === FLAG);
        expect(entry).toMatchObject({ requiresRestart: false, validate: 'boolean', secret: false });
    });
});
