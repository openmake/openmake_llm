/**
 * Agent Plugins v1 확장 매니페스트 검증 (순수 함수).
 *
 * 대상 포맷:
 *   - plugin.json  — { name, version, description?, mcpServers? }
 *   - mcp.json     — { mcpServers: { <name>: { command, args?, env? } | { url, type? } } }
 *     (plugin.json 의 mcpServers 필드와 동일 shape — plugin.json 이 우선)
 *
 * 지원 transport: stdio(command) / streamable-http(url). 레거시 HTTP+SSE 미지원 (v1 spec).
 *
 * @module agents/git-ingest/extension-manifest-validator
 */
import { z } from 'zod';

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const mcpServerEntrySchema = z.object({
    command: z.string().min(1).max(500).optional(),
    args: z.array(z.string().max(500)).max(50).optional(),
    env: z.record(z.string(), z.string().max(2000)).optional(),
    url: z.url().optional(),
    type: z.string().max(50).optional(),
});

const pluginManifestSchema = z.object({
    name: z.string().min(1).max(80).regex(NAME_PATTERN, 'name 은 소문자/숫자/대시 (kebab-case)'),
    version: z.string().min(1).max(40),
    description: z.string().max(500).optional(),
    mcpServers: z.record(z.string().min(1).max(80), mcpServerEntrySchema).optional(),
});

export interface NormalizedMcpServer {
    name: string;
    transportType: 'stdio' | 'streamable-http';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
}

export interface ExtensionManifest {
    name: string;
    version: string;
    description?: string;
    mcpServers: NormalizedMcpServer[];
    /** 원문 (user_extensions.manifest 저장용) */
    raw: Record<string, unknown>;
}

export type ValidationResult =
    | { ok: true; manifest: ExtensionManifest }
    | { ok: false; errors: string[] };

/**
 * mcpServers record → 정규화 배열. 지원 불가 항목은 errors 로 수집.
 */
export function normalizeMcpServers(
    record: Record<string, z.infer<typeof mcpServerEntrySchema>>,
): { servers: NormalizedMcpServer[]; errors: string[] } {
    const servers: NormalizedMcpServer[] = [];
    const errors: string[] = [];
    for (const [name, entry] of Object.entries(record)) {
        if (entry.type === 'sse') {
            errors.push(`${name}: 레거시 HTTP+SSE transport 미지원`);
            continue;
        }
        if (entry.command) {
            servers.push({
                name,
                transportType: 'stdio',
                command: entry.command,
                args: entry.args,
                env: entry.env,
            });
        } else if (entry.url) {
            servers.push({
                name,
                transportType: 'streamable-http',
                url: entry.url,
                env: entry.env,
            });
        } else {
            errors.push(`${name}: command 또는 url 필수`);
        }
    }
    return { servers, errors };
}

/** plugin.json 원문 파싱 + 검증. */
export function validateExtensionManifest(jsonText: string): ValidationResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        return { ok: false, errors: ['plugin.json 이 유효한 JSON 이 아님'] };
    }
    const result = pluginManifestSchema.safeParse(parsed);
    if (!result.success) {
        return {
            ok: false,
            errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
        };
    }
    const norm = result.data.mcpServers
        ? normalizeMcpServers(result.data.mcpServers)
        : { servers: [], errors: [] };
    if (norm.errors.length > 0) {
        return { ok: false, errors: norm.errors };
    }
    return {
        ok: true,
        manifest: {
            name: result.data.name,
            version: result.data.version,
            description: result.data.description,
            mcpServers: norm.servers,
            raw: parsed as Record<string, unknown>,
        },
    };
}

// ── marketplace.json (Claude Code 마켓플레이스 인덱스) ──────────────────────

const marketplaceSourceSchema = z.union([
    // 상대 경로 축약형 ("./plugins/foo")
    z.string().min(1).max(500),
    // git-subdir 등 객체형 ({ source, url, path, ref })
    z.object({
        source: z.string().max(50).optional(),
        url: z.string().max(500).optional(),
        path: z.string().max(500).optional(),
        ref: z.string().max(200).optional(),
    }),
]);

const marketplaceSchema = z.object({
    name: z.string().min(1).max(120),
    plugins: z.array(z.object({
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional(),
        source: marketplaceSourceSchema.optional(),
        category: z.string().max(100).optional(),
    })).max(500),
});

export interface MarketplacePluginEntry {
    name: string;
    description?: string;
    /** 다른 저장소를 가리키는 경우 (git-subdir url) */
    url?: string;
    /** 플러그인 루트 디렉토리 (저장소 상대 경로, './' 정규화됨) */
    path?: string;
    /** 고정 ref (태그/브랜치/SHA) — 설치 시 tracking_ref 로 영속 */
    ref?: string;
    /** 마켓플레이스 분류 (카탈로그 UI 필터용 — 자유 문자열) */
    category?: string;
}

export interface MarketplaceIndex {
    name: string;
    plugins: MarketplacePluginEntry[];
}

export type MarketplaceParseResult =
    | { ok: true; marketplace: MarketplaceIndex }
    | { ok: false; errors: string[] };

/** marketplace.json 파싱 + 엔트리 정규화 (path traversal 차단). */
export function parseMarketplaceFile(jsonText: string): MarketplaceParseResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        return { ok: false, errors: ['marketplace.json 이 유효한 JSON 이 아님'] };
    }
    const result = marketplaceSchema.safeParse(parsed);
    if (!result.success) {
        return { ok: false, errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) };
    }
    const plugins: MarketplacePluginEntry[] = [];
    const errors: string[] = [];
    for (const p of result.data.plugins) {
        let url: string | undefined;
        let path: string | undefined;
        let ref: string | undefined;
        if (typeof p.source === 'string') {
            path = p.source;
        } else if (p.source) {
            url = p.source.url;
            path = p.source.path;
            ref = p.source.ref;
        }
        path = path?.replace(/^\.\//, '').replace(/\/+$/, '');
        if (path && path.includes('..')) {
            errors.push(`${p.name}: path traversal 차단 — .. 미허용`);
            continue;
        }
        plugins.push({ name: p.name, description: p.description, url, path, ref, category: p.category });
    }
    if (plugins.length === 0) {
        return { ok: false, errors: errors.length > 0 ? errors : ['plugins 목록이 비어있음'] };
    }
    return { ok: true, marketplace: { name: result.data.name, plugins } };
}

/**
 * 별도 mcp.json 파싱 ({ mcpServers: {...} } 또는 최상위가 곧 server record 인 축약형).
 * plugin.json 에 mcpServers 가 이미 있으면 호출하지 않는다 (plugin.json 우선).
 */
export function parseMcpJsonFile(jsonText: string): { servers: NormalizedMcpServer[]; errors: string[] } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        return { servers: [], errors: ['mcp.json 이 유효한 JSON 이 아님'] };
    }
    const obj = parsed as Record<string, unknown>;
    const record = (obj && typeof obj === 'object' && obj.mcpServers && typeof obj.mcpServers === 'object')
        ? obj.mcpServers
        : obj;
    const result = z.record(z.string().min(1).max(80), mcpServerEntrySchema).safeParse(record);
    if (!result.success) {
        return { servers: [], errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) };
    }
    return normalizeMcpServers(result.data);
}
