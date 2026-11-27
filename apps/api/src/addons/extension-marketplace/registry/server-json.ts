/**
 * 레지스트리 응답 항목(`{ server, _meta }`) → 저장할 값. 순수 함수 — 네트워크·DB 없음.
 *
 * - `$schema` 가 고정 스키마와 다르면 건너뛴다(`unknown_schema`) — 모르는 형식을 추측해서 담지 않는다.
 * - 이름은 `<역DNS 네임스페이스>/<이름>` — 레지스트리가 게시 때 그 네임스페이스 소유(GitHub·DNS·HTTP)를 확인했다는 뜻뿐이다.
 *   그래서 화면은 "게시자 확인" 만 표시한다(코드·보안 검토를 뜻하지 않는다).
 * - 설치 정보는 원격(`remotes`)과 패키지(`packages`)의 **선언값만** 담는다. env 는 이름·설명·필수·비밀 여부만(기본값 제외).
 *
 * @module addons/extension-marketplace/registry/server-json
 */
import { OFFICIAL_META_KEY, PINNED_SERVER_SCHEMA, REGISTRY_LIMITS } from './constants';

export type RegistryStatus = 'active' | 'deprecated' | 'deleted';

export interface RegistryRemote {
    type: string;
    url: string;
}

export interface RegistryEnvVar {
    name: string;
    description: string | null;
    required: boolean;
    secret: boolean;
}

export interface RegistryPackage {
    registryType: string;
    identifier: string;
    version: string | null;
    transport: string;
    env: RegistryEnvVar[];
}

export interface RegistryEntry {
    serverName: string;
    namespace: string;
    version: string;
    schemaUrl: string;
    title: string | null;
    description: string | null;
    websiteUrl: string | null;
    repositoryUrl: string | null;
    remotes: RegistryRemote[];
    packages: RegistryPackage[];
    status: RegistryStatus;
    statusMessage: string | null;
    isLatest: boolean;
    publishedAt: string | null;
    updatedAt: string | null;
}

export type ParseResult =
    | { ok: true; entry: RegistryEntry }
    | { ok: false; reason: 'unknown_schema' | 'malformed' };

const NAME_PATTERN = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;
const STATUSES: ReadonlySet<string> = new Set(['active', 'deprecated', 'deleted']);

function obj(v: unknown): Record<string, unknown> | null {
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function text(v: unknown, max: number = REGISTRY_LIMITS.MAX_TEXT): string | null {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t ? t.slice(0, max) : null;
}

/** http(s) 만 받는다 — 다른 스킴은 버린다 */
function httpUrl(v: unknown): string | null {
    const s = text(v);
    if (!s) return null;
    try {
        const u = new URL(s);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
    } catch {
        return null;
    }
}

function iso(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function parseRemotes(v: unknown): RegistryRemote[] {
    if (!Array.isArray(v)) return [];
    const out: RegistryRemote[] = [];
    for (const r of v.slice(0, REGISTRY_LIMITS.MAX_REMOTES)) {
        const o = obj(r);
        const type = text(o?.type, 40);
        const url = httpUrl(o?.url);
        if (type && url) out.push({ type, url });
    }
    return out;
}

function parseEnv(v: unknown): RegistryEnvVar[] {
    if (!Array.isArray(v)) return [];
    const out: RegistryEnvVar[] = [];
    for (const e of v.slice(0, REGISTRY_LIMITS.MAX_ENV_VARS)) {
        const o = obj(e);
        const name = text(o?.name, 200);
        if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
        out.push({ name, description: text(o?.description, 500), required: o?.isRequired === true, secret: o?.isSecret === true });
    }
    return out;
}

function parsePackages(v: unknown): RegistryPackage[] {
    if (!Array.isArray(v)) return [];
    const out: RegistryPackage[] = [];
    for (const p of v.slice(0, REGISTRY_LIMITS.MAX_PACKAGES)) {
        const o = obj(p);
        const registryType = text(o?.registryType, 40);
        const identifier = text(o?.identifier, 300);
        if (!registryType || !identifier) continue;
        out.push({
            registryType,
            identifier,
            version: text(o?.version, 100),
            transport: text(obj(o?.transport)?.type, 40) ?? 'stdio',
            env: parseEnv(o?.environmentVariables),
        });
    }
    return out;
}

export function parseRegistryItem(item: unknown): ParseResult {
    const root = obj(item);
    const server = obj(root?.server);
    if (!server) return { ok: false, reason: 'malformed' };
    if (server.$schema !== PINNED_SERVER_SCHEMA) return { ok: false, reason: 'unknown_schema' };
    const serverName = text(server.name, 200);
    const version = text(server.version, 100);
    const meta = obj(obj(root?._meta)?.[OFFICIAL_META_KEY]);
    const status = typeof meta?.status === 'string' && STATUSES.has(meta.status) ? meta.status as RegistryStatus : null;
    if (!serverName || !NAME_PATTERN.test(serverName) || !version || !status) return { ok: false, reason: 'malformed' };
    return {
        ok: true,
        entry: {
            serverName,
            namespace: serverName.slice(0, serverName.indexOf('/')),
            version,
            schemaUrl: PINNED_SERVER_SCHEMA,
            title: text(server.title, 200),
            description: text(server.description),
            websiteUrl: httpUrl(server.websiteUrl),
            repositoryUrl: httpUrl(obj(server.repository)?.url),
            remotes: parseRemotes(server.remotes),
            packages: parsePackages(server.packages),
            status,
            statusMessage: text(meta?.statusMessage, 500),
            isLatest: meta?.isLatest === true,
            publishedAt: iso(meta?.publishedAt),
            updatedAt: iso(meta?.updatedAt),
        },
    };
}
