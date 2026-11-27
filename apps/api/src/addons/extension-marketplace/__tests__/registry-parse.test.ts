/**
 * MCP Registry 응답 해석(server-json)·페이지 요청(registry-client)·카탈로그 초안 변환(promote) — 순수 함수.
 */
import { registryItem } from './registry-fixtures';
import { parseRegistryItem } from '../registry/server-json';
import { buildPageUrl, fetchRegistryPage, parseRetryAfter } from '../registry/registry-client';
import { catalogIdFor, planCatalogDraft } from '../registry/promote';
import type { StoredRegistryEntry } from '../registry/registry-repository';

const item = registryItem;

function stored(over: Partial<StoredRegistryEntry> = {}): StoredRegistryEntry {
    return {
        serverName: 'io.github.acme/weather', namespace: 'io.github.acme', version: '1.2.0', title: 'Weather', description: '날씨',
        websiteUrl: null, repositoryUrl: null, remotes: [], packages: [], status: 'active', statusMessage: null, publishedAt: null,
        registryUpdatedAt: null, tombstonedAt: null, curation: 'approved', curatedAt: null, promotedCatalogId: null, lastSeenAt: '', ...over,
    };
}

describe('parseRegistryItem', () => {
    it('고정 스키마 항목을 담는다 — 네임스페이스·원격·상태', () => {
        const r = parseRegistryItem(item());
        expect(r).toMatchObject({ ok: true, entry: { serverName: 'io.github.acme/weather', namespace: 'io.github.acme', version: '1.2.0', status: 'active', isLatest: true } });
        if (r.ok) expect(r.entry.remotes).toEqual([{ type: 'streamable-http', url: 'https://mcp.acme.dev/mcp' }]);
    });

    it('모르는 스키마(다른 날짜)는 건너뛴다', () => {
        expect(parseRegistryItem(item({ $schema: 'https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json' }))).toEqual({ ok: false, reason: 'unknown_schema' });
        expect(parseRegistryItem(item({ $schema: undefined }))).toEqual({ ok: false, reason: 'unknown_schema' });
    });

    it('이름·판·상태가 없거나 이상하면 malformed', () => {
        expect(parseRegistryItem(item({ name: 'no-slash' }))).toEqual({ ok: false, reason: 'malformed' });
        expect(parseRegistryItem(item({}, { status: 'gone' }))).toEqual({ ok: false, reason: 'malformed' });
        expect(parseRegistryItem(null)).toEqual({ ok: false, reason: 'malformed' });
    });

    it('http(s) 가 아닌 주소는 버리고, env 는 이름·필수·비밀만(기본값 제외)', () => {
        const r = parseRegistryItem(item({
            websiteUrl: 'javascript:alert(1)',
            remotes: [{ type: 'sse', url: 'file:///etc/passwd' }],
            packages: [{ registryType: 'npm', identifier: '@acme/weather-mcp', version: '1.2.0', transport: { type: 'stdio' },
                environmentVariables: [{ name: 'API_KEY', isSecret: true, isRequired: true, default: 'leak' }, { name: 'bad name' }] }],
        }));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.entry.websiteUrl).toBeNull();
        expect(r.entry.remotes).toEqual([]);
        expect(r.entry.packages[0].env).toEqual([{ name: 'API_KEY', description: null, required: true, secret: true }]);
        expect(JSON.stringify(r.entry)).not.toContain('leak');
    });
});

describe('registry-client', () => {
    it('첫 전체 동기화는 version=latest, 증분은 updated_since(삭제 포함), 커서를 잇는다', () => {
        expect(buildPageUrl({ baseUrl: 'https://r.example', cursor: null, updatedSince: null })).toBe('https://r.example/v0.1/servers?limit=100&version=latest');
        const u = new URL(buildPageUrl({ baseUrl: 'https://r.example', cursor: 'a/b:1.0.0', updatedSince: '2026-11-01T00:00:00.000Z' }));
        expect(u.searchParams.get('cursor')).toBe('a/b:1.0.0');
        expect(u.searchParams.get('updated_since')).toBe('2026-11-01T00:00:00.000Z');
        expect(u.searchParams.get('version')).toBeNull();
    });

    it('Retry-After — 초·HTTP 날짜·없음', () => {
        const now = Date.parse('2026-11-28T00:00:00Z');
        expect(parseRetryAfter('30', now)).toBe(30_000);
        expect(parseRetryAfter(new Date(now + 90_000).toUTCString(), now)).toBe(90_000);
        expect(parseRetryAfter(null, now)).toBe(60_000);
        expect(parseRetryAfter('99999999', now)).toBe(6 * 60 * 60 * 1000);
    });

    it('429 는 rate_limited, 5xx 는 failed, 정상은 servers·nextCursor', async () => {
        const f429 = jest.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '12' } }));
        expect(await fetchRegistryPage({ baseUrl: 'https://r.example', cursor: null, updatedSince: null }, f429)).toEqual({ kind: 'rate_limited', retryAfterMs: 12_000 });
        const f500 = jest.fn().mockResolvedValue(new Response('x', { status: 503 }));
        expect(await fetchRegistryPage({ baseUrl: 'https://r.example', cursor: null, updatedSince: null }, f500)).toEqual({ kind: 'failed', message: 'HTTP 503' });
        const ok = jest.fn().mockResolvedValue(new Response(JSON.stringify({ servers: [item()], metadata: { nextCursor: 'n', count: 1 } }), { status: 200 }));
        const r = await fetchRegistryPage({ baseUrl: 'https://r.example', cursor: null, updatedSince: null }, ok);
        expect(r).toMatchObject({ kind: 'ok', nextCursor: 'n' });
        // 자격증명 없이 GET, 리다이렉트 거부
        expect(ok.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error' });
        expect(JSON.stringify(ok.mock.calls[0][1].headers)).not.toMatch(/authorization|cookie/i);
    });

    it('네트워크 오류·깨진 JSON 은 failed(던지지 않는다)', async () => {
        const boom = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
        expect((await fetchRegistryPage({ baseUrl: 'https://r.example', cursor: null, updatedSince: null }, boom)).kind).toBe('failed');
        const bad = jest.fn().mockResolvedValue(new Response('{nope', { status: 200 }));
        expect((await fetchRegistryPage({ baseUrl: 'https://r.example', cursor: null, updatedSince: null }, bad)).kind).toBe('failed');
    });
});

describe('planCatalogDraft', () => {
    it('id 는 mcp-reg-<slug>', () => {
        expect(catalogIdFor('io.github.Acme/Weather_MCP')).toBe('mcp-reg-io-github-acme-weather-mcp');
        expect(catalogIdFor('a/' + 'x'.repeat(300)).length).toBeLessThanOrEqual(100);
    });

    it('원격 streamable-http 를 우선, 템플릿 변수 URL 은 제외', () => {
        const p = planCatalogDraft(stored({ remotes: [
            { type: 'streamable-http', url: 'https://{tenant}.acme.dev/mcp' },
            { type: 'sse', url: 'https://mcp.acme.dev/sse' },
        ] }));
        expect(p).toMatchObject({ ok: true, input: { transportType: 'sse', urlTemplate: 'https://mcp.acme.dev/sse' } });
    });

    it('npm·PyPI 는 버전 고정 명령, env 는 secret 표시', () => {
        const env = [{ name: 'API_KEY', description: '키', required: true, secret: true }];
        expect(planCatalogDraft(stored({ packages: [{ registryType: 'npm', identifier: '@acme/w', version: '1.2.0', transport: 'stdio', env }] })))
            .toMatchObject({ ok: true, input: { transportType: 'stdio', commandTemplate: 'npx -y @acme/w@1.2.0', envSchema: { required: ['API_KEY'], properties: { API_KEY: { secret: true } } } } });
        expect(planCatalogDraft(stored({ packages: [{ registryType: 'pypi', identifier: 'acme-w', version: '0.3', transport: 'stdio', env: [] }] })))
            .toMatchObject({ ok: true, input: { commandTemplate: 'uvx acme-w==0.3' } });
    });

    it('옮길 수 없는 경우 — 승인 전·지워짐·OCI·버전 없음·셸 문자', () => {
        expect(planCatalogDraft(stored({ curation: 'pending' }))).toEqual({ ok: false, reason: 'NOT_APPROVED' });
        expect(planCatalogDraft(stored({ tombstonedAt: '2026-11-01T00:00:00Z' }))).toEqual({ ok: false, reason: 'TOMBSTONED' });
        const pkg = (o: Record<string, unknown>) => stored({ packages: [{ registryType: 'npm', identifier: 'w', version: '1.0.0', transport: 'stdio', env: [], ...o }] });
        expect(planCatalogDraft(pkg({ registryType: 'oci' }))).toEqual({ ok: false, reason: 'NO_SUPPORTED_INSTALL' });
        expect(planCatalogDraft(pkg({ version: 'latest' }))).toEqual({ ok: false, reason: 'NO_SUPPORTED_INSTALL' });
        expect(planCatalogDraft(pkg({ identifier: 'w; rm -rf /' }))).toEqual({ ok: false, reason: 'NO_SUPPORTED_INSTALL' });
        expect(planCatalogDraft(pkg({ version: '1.0.0 && x' }))).toEqual({ ok: false, reason: 'NO_SUPPORTED_INSTALL' });
    });
});
