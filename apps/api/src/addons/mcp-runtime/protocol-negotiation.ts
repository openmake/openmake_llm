/**
 * MCP 프로토콜 협상 방식(MCP-2, 2026-11-27) — 외부 MCP 서버에 연결할 때 새 방식(2026-07-28 `server/discover`)을
 * 먼저 시도할지 정한다.
 *
 * - 플래그 `MCP_PROTOCOL_NEGOTIATION` = `legacy`(기본) · `auto`. 모르는 값·읽기 실패는 `legacy` 로 본다.
 *   `legacy` 면 SDK Client 에 협상 옵션을 넘기지 않고 `connect()` 도 종전 인자 그대로 부른다 — 바이트 단위로 종전과 같다.
 * - `auto` 면 SDK 가 `server/discover` 로 탐지하고, 명확한 새 방식 증거가 없으면 구 방식(`initialize`)으로 폴백한다.
 *   401·403 은 SDK 규칙대로 폴백하지 않고 그대로 실패한다(여기서 잡아 재시도하지 않는다).
 * - 탐지 결과(era 판정)는 서버별로 이 프로세스에 기억해 재연결 때 `connect({ prior })` 로 넘긴다 — stdio 는 탐지가
 *   형제 프로세스 하나를 더 띄우므로 재연결마다 탐지하지 않게. 구 방식 판정은 SDK 권고대로 날짜를 붙여
 *   {@link MCP_LEGACY_PRIOR_TTL_MS} 가 지나면 버린다(서버가 갱신돼도 구 방식 응답은 계속 성공하기 때문).
 *   기억은 서버 id 단위(= 한 인가 문맥 — 사용자 서버 행은 사용자마다 따로다)이고 연결이 실패하면 지운다.
 *
 * @module addons/mcp-runtime/protocol-negotiation
 */
import { readSettingValue } from '../../config/env';

/** 플래그 키 — 기여 설정(contributions)·ops-features.env 가 같은 이름을 쓴다 */
export const MCP_PROTOCOL_NEGOTIATION_FLAG = 'MCP_PROTOCOL_NEGOTIATION';
/** 탐지 타임아웃 override 키(ms) */
export const MCP_NEGOTIATION_PROBE_TIMEOUT_KEY = 'MCP_NEGOTIATION_PROBE_TIMEOUT_MS';

export const MCP_NEGOTIATION_MODES = ['legacy', 'auto'] as const;
export type McpNegotiationMode = (typeof MCP_NEGOTIATION_MODES)[number];

/**
 * 탐지(`server/discover`) 응답 대기 상한 — stdio 에서 응답이 없으면 구 방식 서버로 보고 폴백한다.
 * SDK 기본은 일반 요청 타임아웃(60초)이라 조용한 구 서버의 첫 연결이 1분 늦어지므로 짧게 둔다.
 */
export const MCP_NEGOTIATION_PROBE_TIMEOUT_MS = 5_000;
/** 탐지 타임아웃 override 허용 범위 — 너무 짧으면 느린 새 서버를 구 서버로 오판한다 */
export const MCP_NEGOTIATION_PROBE_TIMEOUT_MIN_MS = 500;
export const MCP_NEGOTIATION_PROBE_TIMEOUT_MAX_MS = 60_000;
/** 구 방식 판정의 유효 기간 — 지나면 다음 연결에서 다시 탐지한다(서버 갱신을 알아채게) */
export const MCP_LEGACY_PRIOR_TTL_MS = 24 * 60 * 60 * 1000;
/** 기억하는 서버 수 상한 — 넘으면 가장 오래된 것부터 버린다 */
export const MCP_PRIOR_CACHE_MAX_ENTRIES = 1_000;

function readSetting(key: string): string | undefined {
    try {
        return readSettingValue(key);
    } catch {
        return undefined;
    }
}

/** 현재 협상 방식 — 연결마다 읽는다(system_settings 로 실시간 전환) */
export function resolveNegotiationMode(raw: string | undefined = readSetting(MCP_PROTOCOL_NEGOTIATION_FLAG)): McpNegotiationMode {
    const v = (raw ?? '').trim();
    return (MCP_NEGOTIATION_MODES as readonly string[]).includes(v) ? (v as McpNegotiationMode) : 'legacy';
}

/** 탐지 타임아웃 — 정수가 아니거나 범위 밖이면 기본값 */
export function resolveProbeTimeoutMs(raw: string | undefined = readSetting(MCP_NEGOTIATION_PROBE_TIMEOUT_KEY)): number {
    const n = Number((raw ?? '').trim());
    if (!Number.isInteger(n) || n < MCP_NEGOTIATION_PROBE_TIMEOUT_MIN_MS || n > MCP_NEGOTIATION_PROBE_TIMEOUT_MAX_MS) {
        return MCP_NEGOTIATION_PROBE_TIMEOUT_MS;
    }
    return n;
}

/** SDK `ClientOptions.versionNegotiation` 와 같은 모양(SDK 타입을 직접 import 하지 않고 구조로 맞춘다) */
export interface VersionNegotiationClientOption {
    mode: 'auto';
    probe: { timeoutMs: number; maxRetries: number };
}

/** legacy 면 undefined — Client 생성자에 키 자체를 넣지 않는다 */
export function versionNegotiationOption(mode: McpNegotiationMode, timeoutMs: number = resolveProbeTimeoutMs()): VersionNegotiationClientOption | undefined {
    if (mode !== 'auto') return undefined;
    return { mode: 'auto', probe: { timeoutMs, maxRetries: 0 } };
}

/** SDK `PriorDiscovery` 와 같은 모양 */
export type PriorVerdict = { kind: 'modern'; discover: unknown } | { kind: 'legacy' };

interface CachedVerdict {
    verdict: PriorVerdict;
    at: number;
}

const priorCache = new Map<string, CachedVerdict>();

/** 연결에 넘길 prior — auto 가 아니거나 기억이 없거나 구 방식 판정이 만료됐으면 undefined(탐지한다) */
export function priorFor(serverId: string, mode: McpNegotiationMode, now: number = Date.now()): PriorVerdict | undefined {
    if (mode !== 'auto') return undefined;
    const hit = priorCache.get(serverId);
    if (!hit) return undefined;
    if (hit.verdict.kind === 'legacy' && now - hit.at > MCP_LEGACY_PRIOR_TTL_MS) {
        priorCache.delete(serverId);
        return undefined;
    }
    return hit.verdict;
}

/** 연결된 Client 에서 판정을 읽어 기억한다 — 이미 prior 로 연결했으면 시각을 갱신하지 않는다(만료가 미뤄지지 않게) */
export function rememberVerdict(
    serverId: string,
    mode: McpNegotiationMode,
    client: { getProtocolEra?: () => 'legacy' | 'modern' | undefined; getDiscoverResult?: () => unknown },
    usedPrior: PriorVerdict | undefined,
    now: number = Date.now(),
): void {
    if (mode !== 'auto' || usedPrior) return;
    let era: 'legacy' | 'modern' | undefined;
    let discover: unknown;
    try {
        era = client.getProtocolEra?.();
        discover = client.getDiscoverResult?.();
    } catch {
        return;
    }
    let verdict: PriorVerdict | undefined;
    if (era === 'modern' && discover) verdict = { kind: 'modern', discover };
    else if (era === 'legacy') verdict = { kind: 'legacy' };
    if (!verdict) return;
    priorCache.delete(serverId);
    priorCache.set(serverId, { verdict, at: now });
    while (priorCache.size > MCP_PRIOR_CACHE_MAX_ENTRIES) {
        const oldest = priorCache.keys().next().value;
        if (oldest === undefined) break;
        priorCache.delete(oldest);
    }
}

/** 연결 실패 시 — 낡은 판정(서버가 바뀜)일 수 있으니 버리고 다음 연결이 다시 탐지하게 한다 */
export function forgetVerdict(serverId: string): void {
    priorCache.delete(serverId);
}

/** 테스트 전용 */
export function __resetPriorCacheForTest(): void {
    priorCache.clear();
}
