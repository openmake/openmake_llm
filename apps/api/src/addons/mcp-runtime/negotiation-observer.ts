/**
 * MCP 협상 관측(MCP-1, 2026-11-27) — 연결이 끝난 뒤 서버별 협상 결과를 기록한다.
 *
 * 연결 동작은 바꾸지 않는다(협상은 지금처럼 legacy). 기록은 연결 성공 뒤 **기다리지 않고** 돌며,
 * 무엇이 실패해도 연결·도구 호출에 영향이 없다(fail-open). 플래그 `MCP_NEGOTIATION_OBSERVE_ENABLED`
 * (기본 OFF, system_settings 로 실시간)가 꺼져 있으면 기록 경로를 아예 타지 않는다.
 *
 * 저장하는 것: 전송·인증 방식(분류값만)·협상 리비전·프로토콜 세대·서버가 선언한 capability 키와 확장 id·
 * serverInfo(name·version). **저장하지 않는 것**: URL·명령·인자·env·토큰·client_id·secret·instructions.
 * 서버가 보낸 문자열은 길이·개수 상한으로 자른다(서버가 통제하는 값이라).
 *
 * 소비처: 관리자 현황(M3)·갤러리 호환 판정(M1) — `GET /api/admin/mcp/negotiation` 과
 * {@link McpNegotiationRepository.list}.
 *
 * @module addons/mcp-runtime/negotiation-observer
 */
import { readSettingValue } from '../../config/env';
import { createLogger } from '../../utils/logger';

const logger = createLogger('McpNegotiation');

/** 전송 종류 — Base 계약(`MCPServerConfig.transport_type`)과 같은 값. add-on 경계 때문에 여기서 좁게 다시 적는다 */
export type MCPTransportType = 'stdio' | 'sse' | 'streamable-http';

/** 관측에 쓰는 서버 설정 필드(구조적으로 `MCPServerConfig` 가 그대로 들어온다) */
export interface NegotiationServerRef {
    id: string;
    name: string;
    transport_type: MCPTransportType;
}

/** 플래그 키 — 기여 설정(contributions)과 ops-features.env 가 같은 이름을 쓴다 */
export const MCP_NEGOTIATION_OBSERVE_FLAG = 'MCP_NEGOTIATION_OBSERVE_ENABLED';

/** 서버가 보낸 문자열 하나의 저장 상한(자) */
export const NEGOTIATION_TEXT_MAX_CHARS = 200;
/** capability 키·확장 id 목록의 저장 상한(개) */
export const NEGOTIATION_LIST_MAX_ITEMS = 50;

/** 인증 방식 분류 — 코드가 실제로 구분할 수 있는 것만 */
export type McpAuthMethod =
    /** stdio, 또는 OAuth provider 가 붙지 않은 원격(전역) 서버 */
    | 'none'
    /** OAuth provider 는 붙었지만 서버가 인증을 요구하지 않아 토큰이 없다 */
    | 'oauth-not-required'
    /** 관리자가 카탈로그에 넣은 사전 등록 OAuth 클라이언트(155) */
    | 'oauth-preregistered'
    /** 동적 클라이언트 등록(DCR)으로 받은 클라이언트 */
    | 'oauth-dynamic'
    /** OAuth 토큰은 있으나 클라이언트 정보 출처를 확인하지 못함 */
    | 'oauth-unknown';

/**
 * 서버 SDK 세대 추정 — 연결 결과만으로 확정할 수 있는 범위로 한정한다.
 * legacy(2025 initialize) 연결은 v1 SDK 와 v2 SDK 의 하위 호환 응답을 구별할 수 없어 `v1-compatible` 로 둔다.
 */
export type McpSdkGenerationHint = 'v2' | 'v1-compatible' | 'unknown';

export interface McpExtensionRef {
    id: string;
    version?: string;
}

export interface McpNegotiationObservation {
    serverId: string;
    transport: MCPTransportType;
    authMethod: McpAuthMethod;
    protocolEra: 'legacy' | 'modern' | null;
    protocolVersion: string | null;
    sdkGeneration: McpSdkGenerationHint;
    capabilities: string[];
    extensions: McpExtensionRef[];
    serverName: string | null;
    serverVersion: string | null;
}

/** 관측에 필요한 SDK Client 의 읽기 메서드 — 버전마다 없을 수 있어 전부 선택 */
export interface NegotiationSource {
    getServerCapabilities?: () => unknown;
    getServerVersion?: () => { name?: unknown; version?: unknown } | undefined;
    getNegotiatedProtocolVersion?: () => string | undefined;
    getProtocolEra?: () => 'legacy' | 'modern' | undefined;
}

/** 인증 판정에 쓰는 OAuth provider 의 읽기 메서드(값은 존재 여부만 본다) */
export interface NegotiationAuthSource {
    staticClient(): Promise<unknown>;
    tokens(): Promise<unknown>;
    clientInformation(): Promise<unknown>;
}

export interface NegotiationSink {
    upsert(o: McpNegotiationObservation): Promise<void>;
}

/** 플래그 — 읽기 실패(설정 계층 미초기화 등)는 OFF 로 본다 */
export function isNegotiationObserveEnabled(): boolean {
    try {
        return readSettingValue(MCP_NEGOTIATION_OBSERVE_FLAG) === 'true';
    } catch {
        return false;
    }
}

function clip(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (!s) return null;
    return s.length > NEGOTIATION_TEXT_MAX_CHARS ? s.slice(0, NEGOTIATION_TEXT_MAX_CHARS) : s;
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** capability 객체 → 선언된 최상위 키(값이 있는 것만) */
function capabilityKeys(caps: unknown): string[] {
    if (!isRecord(caps)) return [];
    return Object.keys(caps)
        .filter(k => caps[k] !== undefined && caps[k] !== null && caps[k] !== false)
        .map(k => clip(k)).filter((k): k is string => !!k)
        .sort()
        .slice(0, NEGOTIATION_LIST_MAX_ITEMS);
}

/**
 * 선언된 확장 — 2026-07-28 확장 협상(SEP-2133)의 `capabilities.extensions`(역DNS id → 설정)와
 * 그 이전 관례인 `capabilities.experimental` 키를 함께 본다. 설정 값은 저장하지 않고 version 문자열만.
 */
function extensionRefs(caps: unknown): McpExtensionRef[] {
    if (!isRecord(caps)) return [];
    const out = new Map<string, McpExtensionRef>();
    for (const field of ['extensions', 'experimental'] as const) {
        const group = caps[field];
        if (!isRecord(group)) continue;
        for (const [rawId, cfg] of Object.entries(group)) {
            const id = clip(rawId);
            if (!id || out.has(id)) continue;
            const version = isRecord(cfg) ? clip(cfg.version) : null;
            out.set(id, version ? { id, version } : { id });
        }
    }
    return [...out.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, NEGOTIATION_LIST_MAX_ITEMS);
}

function sdkGenerationOf(era: 'legacy' | 'modern' | null): McpSdkGenerationHint {
    if (era === 'modern') return 'v2';
    if (era === 'legacy') return 'v1-compatible';
    return 'unknown';
}

function safeCall<T>(fn: (() => T) | undefined): T | undefined {
    if (!fn) return undefined;
    try { return fn(); } catch { return undefined; }
}

/** PURE: 연결된 SDK Client 와 서버 설정에서 기록값을 뽑는다 */
export function extractNegotiationObservation(
    config: Pick<NegotiationServerRef, 'id' | 'transport_type'>,
    source: NegotiationSource,
    authMethod: McpAuthMethod,
): McpNegotiationObservation {
    const caps = safeCall(source.getServerCapabilities?.bind(source));
    const info = safeCall(source.getServerVersion?.bind(source));
    const era = safeCall(source.getProtocolEra?.bind(source)) ?? null;
    return {
        serverId: config.id,
        transport: config.transport_type,
        authMethod,
        protocolEra: era === 'legacy' || era === 'modern' ? era : null,
        protocolVersion: clip(safeCall(source.getNegotiatedProtocolVersion?.bind(source))),
        sdkGeneration: sdkGenerationOf(era === 'legacy' || era === 'modern' ? era : null),
        capabilities: capabilityKeys(caps),
        extensions: extensionRefs(caps),
        serverName: clip(info?.name),
        serverVersion: clip(info?.version),
    };
}

/** 인증 방식 분류 — 값은 읽지 않고 존재 여부만 본다 */
export async function resolveAuthMethod(
    transport: MCPTransportType,
    auth: NegotiationAuthSource | undefined,
): Promise<McpAuthMethod> {
    if (transport === 'stdio' || !auth) return 'none';
    if (await auth.staticClient()) return 'oauth-preregistered';
    if (!(await auth.tokens())) return 'oauth-not-required';
    return (await auth.clientInformation()) ? 'oauth-dynamic' : 'oauth-unknown';
}

let registeredSink: NegotiationSink | null = null;

/** 저장소 등록 — 런타임 부팅(`runtime-boot.startToolRuntime`)이 DB 저장소를 넣는다. 없으면 기록하지 않는다 */
export function setNegotiationSink(sink: NegotiationSink | null): void {
    registeredSink = sink;
}

/**
 * 연결 직후 호출 — 기다리지 않아도 되고(반환 promise 는 절대 reject 하지 않는다) 플래그가 꺼져 있으면 즉시 끝난다.
 */
export async function observeNegotiation(
    config: NegotiationServerRef,
    source: NegotiationSource,
    auth: NegotiationAuthSource | undefined,
    sink?: NegotiationSink,
): Promise<void> {
    if (!isNegotiationObserveEnabled()) return;
    const target = sink ?? registeredSink;
    if (!target) return;
    try {
        const authMethod = await resolveAuthMethod(config.transport_type, auth);
        const observation = extractNegotiationObservation(config, source, authMethod);
        await target.upsert(observation);
    } catch (err) {
        logger.debug(`"${config.name}" 협상 관측 기록 실패(무시): ${err instanceof Error ? err.message : String(err)}`);
    }
}
