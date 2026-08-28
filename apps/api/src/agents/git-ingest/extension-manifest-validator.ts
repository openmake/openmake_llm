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
 * ⚠️ 항목 단위 관용 파싱: mcpServers record 는 **항목별로** 검증한다. 한 항목이
 * 무효(빈 url, sse, 미지원 필드)여도 나머지는 설치되고 사유만 warnings 로 전달된다
 * — record 전체를 한 번에 safeParse 하면 upstream 의 `"url": ""` placeholder 하나가
 * 서버 9개를 통째로 버리는 일이 실제로 발생했다 (knowledge-work-plugins/design).
 *
 * @module agents/git-ingest/extension-manifest-validator
 */
import { z } from 'zod';
import { UNSUPPORTED_MCP_FIELDS } from '../../config/skill-compat';
import type { UserConfigEntry } from '../../mcp/env-placeholder';

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
    // upstream 다수가 version 을 생략한다 (Anthropic 공식 25개 중 16개 — 2026-08-24 실측).
    // 필수로 강제하면 그 플러그인들은 설치 자체가 불가하므로 기본값으로 관용 처리한다.
    // 업데이트 판정 기준은 version 이 아니라 source_ref(commit sha) 라 부작용이 없다.
    version: z.string().min(1).max(40).default('0.0.0'),
    description: z.string().max(500).optional(),
    // ⚠️ 항목 검증은 normalizeMcpServers 가 담당 — 여기서 엄격히 보면 무효 항목 하나가
    // 매니페스트 전체를 거절해 유효한 서버까지 버려진다 (항목 단위 관용 파싱).
    mcpServers: z.record(z.string().min(1).max(80), z.unknown()).optional(),
    // Claude Code 의 사용자 입력 스키마. env 의 `${user_config.X}` 자리표시자가 이 항목을
    // 가리키며, 승인 화면이 title/description 을 입력 라벨·발급 안내로 쓴다.
    // 관용 파싱 — 형태가 어긋난 항목은 힌트만 잃고 설치는 계속된다.
    userConfig: z.record(
        z.string().min(1).max(80),
        z.object({
            title: z.string().max(200).optional(),
            description: z.string().max(1000).optional(),
            sensitive: z.boolean().optional(),
        }).loose(),
    ).optional(),
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
    /** 설치되지 않은 mcpServers 항목의 사유 + 무시된 필드 안내 (설치는 계속 진행) */
    mcpWarnings: string[];
    /** plugin.json `userConfig` — env 자리표시자의 입력 라벨·발급 안내 출처 */
    userConfig?: Record<string, UserConfigEntry>;
    /** 원문 (user_extensions.manifest 저장용) */
    raw: Record<string, unknown>;
}

export type ValidationResult =
    | { ok: true; manifest: ExtensionManifest }
    | { ok: false; errors: string[] };

/**
 * mcpServers record → 정규화 배열 (항목 단위).
 *
 * 반환:
 *   - servers  : 설치 가능한 항목
 *   - errors   : 그 항목을 설치할 수 없는 사유 (다른 항목에는 영향 없음)
 *   - warnings : 설치는 하되 이 환경이 무시하는 필드 (headers/oauth/cwd 등)
 */
export function normalizeMcpServers(
    record: Record<string, unknown>,
): { servers: NormalizedMcpServer[]; errors: string[]; warnings: string[] } {
    const servers: NormalizedMcpServer[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const [name, rawEntry] of Object.entries(record)) {
        const parsedEntry = mcpServerEntrySchema.safeParse(rawEntry);
        if (!parsedEntry.success) {
            errors.push(`${name}: ${parsedEntry.error.issues.map(i => `${i.path.join('.') || 'entry'} ${i.message}`).join(', ')}`);
            continue;
        }
        const entry = parsedEntry.data;
        if (entry.type === 'sse') {
            errors.push(`${name}: 레거시 HTTP+SSE transport 미지원`);
            continue;
        }
        // 이 환경이 주입 경로를 갖지 않는 필드 — 설치는 하되 동작 차이를 알린다
        if (rawEntry && typeof rawEntry === 'object') {
            for (const [field, label] of Object.entries(UNSUPPORTED_MCP_FIELDS)) {
                if (field in (rawEntry as Record<string, unknown>)) {
                    warnings.push(`${name}: ${label}(${field}) 은 이 환경에서 지원되지 않아 무시됩니다`);
                }
            }
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
    return { servers, errors, warnings };
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
    // mcpServers 는 항목 단위 — 일부가 무효여도 매니페스트 자체는 유효로 본다
    // (name/version 등 매니페스트 문법 오류만 실패). 사유는 mcpWarnings 로 전달.
    const rawServers = (parsed as { mcpServers?: unknown }).mcpServers;
    const norm = rawServers && typeof rawServers === 'object'
        ? normalizeMcpServers(rawServers as Record<string, unknown>)
        : { servers: [], errors: [], warnings: [] };
    return {
        ok: true,
        manifest: {
            name: result.data.name,
            version: result.data.version,
            description: result.data.description,
            mcpServers: norm.servers,
            mcpWarnings: [...norm.errors, ...norm.warnings],
            userConfig: result.data.userConfig as Record<string, UserConfigEntry> | undefined,
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
export function parseMcpJsonFile(jsonText: string): { servers: NormalizedMcpServer[]; errors: string[]; warnings: string[] } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        return { servers: [], errors: ['mcp.json 이 유효한 JSON 이 아님'], warnings: [] };
    }
    const obj = parsed as Record<string, unknown>;
    const record = (obj && typeof obj === 'object' && obj.mcpServers && typeof obj.mcpServers === 'object')
        ? obj.mcpServers
        : obj;
    if (!record || typeof record !== 'object') {
        return { servers: [], errors: ['mcp.json 이 서버 목록 객체가 아님'], warnings: [] };
    }
    return normalizeMcpServers(record as Record<string, unknown>);
}
