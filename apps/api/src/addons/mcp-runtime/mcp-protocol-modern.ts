/**
 * MCP 2026-07-28(modern era) 수용 — OpenMake 가 **서버로서** 응답할 때(opt-in).
 *
 * 2026-07-28 리비전은 `initialize` 핸드셰이크가 없다. 클라이언트는 `server/discover`
 * 로 지원 리비전·capability 를 묻고, 이후 모든 요청 `params._meta` 에 봉투
 * (`io.modelcontextprotocol/protocolVersion`·`clientInfo`·`clientCapabilities`)를
 * 싣는다. 서버 결과는 `resultType`(필수)·캐시 힌트(`ttlMs`·`cacheScope` — 캐시 대상
 * 메서드만)·`_meta['io.modelcontextprotocol/serverInfo']` 를 갖는다.
 *
 * 우리 서버가 구현한 메서드는 `tools/list`·`tools/call` 뿐이라 필요한 것도 이 봉투·
 * 결과 형태와 `server/discover` 하나다. tasks·subscriptions·MCP Apps 는 광고하지
 * 않는다(구현하지 않은 것을 광고하지 않는다 — `mcp-protocol.ts` 의 원칙 그대로).
 *
 * 켜짐: env `MCP_SERVER_MODERN_PROTOCOL=true`(기본 OFF). 이 서버는 stdio CLI
 * (`openmake mcp`) 별도 프로세스라 DB 운영 설정 overlay 를 읽지 않는다 — env 전용.
 * OFF 면 `server/discover` 는 종전처럼 "알 수 없는 메서드", 봉투는 무시된다.
 * 구 리비전(initialize) 수용은 ON/OFF 와 무관하게 그대로다.
 *
 * 와이어 형태는 `@modelcontextprotocol/client` 2.4 의 rev2026-07-28 스키마
 * (`DiscoverResultSchema`·encode contract)와 같다 — 통합 테스트가 실제 SDK
 * 클라이언트(pin 2026-07-28 / auto / legacy)로 고정한다.
 *
 * @module addons/mcp-runtime/mcp-protocol-modern
 */

/** 우리 서버가 수용하는 modern-era 리비전 (최신 우선). */
export const MCP_MODERN_PROTOCOL_VERSIONS: readonly string[] = ['2026-07-28'];

/** modern era 의 첫 리비전 — 이 값 이상이면 modern 으로 본다(리비전 문자열은 날짜라 사전순 비교). */
const FIRST_MODERN_PROTOCOL_VERSION = '2026-07-28';

export const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';
export const SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';

/** -32022 UnsupportedProtocolVersion (data: `{ supported, requested }`). */
export const UNSUPPORTED_PROTOCOL_VERSION_CODE = -32022;

/** 캐시 힌트를 채워야 하는 결과 메서드 중 우리가 응답하는 것. */
const CACHEABLE_METHODS: readonly string[] = ['tools/list', 'server/discover'];

/** 캐시 힌트 기본값 — 도구 목록은 프로세스 안에서 바뀔 수 있어 캐시하지 않게 한다. */
const DEFAULT_CACHE_TTL_MS = 0;
const DEFAULT_CACHE_SCOPE = 'private';

const ENV_FLAG = 'MCP_SERVER_MODERN_PROTOCOL';

export function isModernServingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return (env[ENV_FLAG] ?? '').trim().toLowerCase() === 'true';
}

export function isModernRevision(version: unknown): version is string {
    return typeof version === 'string' && version >= FIRST_MODERN_PROTOCOL_VERSION;
}

/** 요청 `params._meta` 봉투의 프로토콜 리비전. 봉투가 없으면 undefined(= legacy 요청). */
export function readEnvelopeVersion(params: unknown): string | undefined {
    if (!params || typeof params !== 'object') return undefined;
    const meta = (params as { _meta?: unknown })._meta;
    if (!meta || typeof meta !== 'object') return undefined;
    const v = (meta as Record<string, unknown>)[PROTOCOL_VERSION_META_KEY];
    return typeof v === 'string' ? v : undefined;
}

/** 봉투 리비전을 우리가 modern 으로 수용하는가. */
export function isSupportedModernVersion(version: string): boolean {
    return MCP_MODERN_PROTOCOL_VERSIONS.includes(version);
}

/** `server/discover` 가 광고할 리비전 — modern 먼저, 구 리비전도 함께(우리는 둘 다 수용한다). */
export function discoverSupportedVersions(legacyVersions: readonly string[]): string[] {
    return [...MCP_MODERN_PROTOCOL_VERSIONS, ...legacyVersions];
}

export interface ModernImplementation {
    name: string;
    version: string;
}

/**
 * modern 결과 봉인 — `resultType`·캐시 힌트(대상 메서드만)·serverInfo `_meta`.
 * 핸들러가 이미 넣은 값은 덮지 않는다(SDK encode contract 와 같은 우선순위).
 */
export function stampModernResult(
    method: string,
    result: Record<string, unknown>,
    serverInfo: ModernImplementation,
): Record<string, unknown> {
    const out: Record<string, unknown> = { ...result };
    if (out.resultType === undefined) out.resultType = 'complete';
    if (out.resultType === 'complete' && CACHEABLE_METHODS.includes(method)) {
        const ttl = out.ttlMs;
        if (!(typeof ttl === 'number' && Number.isInteger(ttl) && ttl >= 0)) out.ttlMs = DEFAULT_CACHE_TTL_MS;
        if (out.cacheScope !== 'public' && out.cacheScope !== 'private') out.cacheScope = DEFAULT_CACHE_SCOPE;
    }
    const meta = out._meta;
    if (meta === undefined) {
        out._meta = { [SERVER_INFO_META_KEY]: serverInfo };
    } else if (meta && typeof meta === 'object' && !Array.isArray(meta)
        && (meta as Record<string, unknown>)[SERVER_INFO_META_KEY] === undefined) {
        out._meta = { ...(meta as Record<string, unknown>), [SERVER_INFO_META_KEY]: serverInfo };
    }
    return out;
}
