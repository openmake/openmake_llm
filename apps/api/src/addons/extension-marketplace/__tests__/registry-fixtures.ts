/** MCP Registry 테스트 공용 — 레지스트리 응답 항목 한 개(고정 스키마) */
import { OFFICIAL_META_KEY, PINNED_SERVER_SCHEMA } from '../registry/constants';

export function registryItem(over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) {
    return {
        server: {
            $schema: PINNED_SERVER_SCHEMA, name: 'io.github.acme/weather', version: '1.2.0', description: '날씨',
            remotes: [{ type: 'streamable-http', url: 'https://mcp.acme.dev/mcp' }], ...over,
        },
        _meta: {
            [OFFICIAL_META_KEY]: {
                status: 'active', isLatest: true, publishedAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z',
                statusChangedAt: '2026-11-02T00:00:00Z', ...meta,
            },
        },
    };
}

export function pageResponse(items: unknown[], nextCursor: string | null): Response {
    return new Response(JSON.stringify({ servers: items, metadata: { nextCursor: nextCursor ?? undefined, count: items.length } }), { status: 200 });
}
