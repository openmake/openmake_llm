/**
 * 서버 주소 찾기 — 사용자가 넣은 주소 하나에서 브리지 연결 주소와 웹 주소를 정한다 (2026-10-05).
 *
 * 종전엔 앱이 주소를 코드에 박아 두거나(macOS: chat.openmake.cc / localhost:52416 두 가지) 포트 규칙으로
 * 추측했다(Windows: 52416 이면 웹은 3000). 설치마다 주소·포트가 다르면 연결하지 못하거나 "웹에서 열기"가 엉뚱한 곳으로 갔다.
 *
 * 이제 사용자는 브라우저에서 쓰는 주소(또는 API 주소)를 하나만 넣는다. 앱은 그 주소의 `GET /api/desktop/config` 로
 * 서버의 API 포트와 웹 포트를 묻고, 넣은 주소의 포트가 어느 쪽인지 보고 나머지를 정한다:
 *   - 웹 포트로 들어왔다  → 웹은 그대로, 연결은 같은 호스트의 API 포트 (개발 서버는 웹이 WebSocket 을 넘겨주지 못한다)
 *   - API 포트로 들어왔다 → 연결은 그대로, 웹은 같은 호스트의 웹 포트
 *   - 둘 다 아니다        → 앞단에 프록시가 있는 배포다. 넣은 주소를 둘 다에 쓴다
 * 조회 경로가 없는 구버전 서버·조회 실패는 넣은 주소를 그대로 쓴다(운영처럼 API 와 웹이 한 주소면 그것으로 충분하다).
 * 호스트는 항상 사용자가 넣은 것을 쓴다 — 서버 응답이 연결 대상을 다른 호스트로 돌리지 못한다.
 */

export interface ServerEndpoints {
    /** 브리지(WebSocket)가 붙는 주소 */
    bridgeUrl: string;
    /** 브라우저로 여는 주소(웹에서 열기·알림 링크·키 발급 페이지) */
    webUrl: string;
    /** 서버가 포트를 알려 줘서 정했는가 — false 면 넣은 주소를 그대로 쓴 것이다 */
    discovered: boolean;
}

/** 서버 설정 조회 경로 */
export const DESKTOP_CONFIG_PATH = '/api/desktop/config';
/** 조회 제한 시간(ms) — 넘기면 넣은 주소를 그대로 쓴다 */
export const DESKTOP_CONFIG_TIMEOUT_MS = 5000;

const DEFAULT_PORT: Readonly<Record<string, number>> = { 'http:': 80, 'https:': 443 };
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

function parse(address: unknown): URL | null {
    if (typeof address !== 'string') return null;
    try {
        const u = new URL(address.trim());
        return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
    } catch {
        return null;
    }
}

/** PURE: 사용자가 넣은 주소 → `방식://호스트[:포트]`. http(s) 주소가 아니면 null. */
export function normalizeServerAddress(address: unknown): string | null {
    return parse(address)?.origin ?? null;
}

/** PURE: 암호화 없이(http) 이 PC 밖의 서버로 가는 주소인가 — API key 가 평문으로 나간다. */
export function isPlainRemoteHttp(address: unknown): boolean {
    const u = parse(address);
    return !!u && u.protocol === 'http:' && !LOOPBACK_HOSTS.has(u.hostname);
}

const validPort = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 65536;

/** PURE: 넣은 주소 + 서버가 알려 준 포트 → 연결 주소와 웹 주소. 주소가 잘못됐으면 던진다. */
export function resolveEndpoints(address: string, config: unknown): ServerEndpoints {
    const u = parse(address);
    if (!u) throw new Error(`서버 주소가 올바르지 않습니다: ${address}`);
    const entered = u.origin;
    const cfg = (config ?? {}) as { apiPort?: unknown; webPort?: unknown };
    if (!validPort(cfg.apiPort) || !validPort(cfg.webPort)) return { bridgeUrl: entered, webUrl: entered, discovered: false };
    const port = u.port ? Number(u.port) : DEFAULT_PORT[u.protocol];
    const at = (p: number): string => (p === DEFAULT_PORT[u.protocol] ? `${u.protocol}//${u.hostname}` : `${u.protocol}//${u.hostname}:${p}`);
    if (cfg.apiPort === cfg.webPort || (port !== cfg.apiPort && port !== cfg.webPort)) return { bridgeUrl: entered, webUrl: entered, discovered: true };
    return { bridgeUrl: at(cfg.apiPort), webUrl: at(cfg.webPort), discovered: true };
}

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** 넣은 주소의 서버에 포트를 물어 연결 주소와 웹 주소를 정한다. 조회 실패는 넣은 주소 그대로, 주소가 잘못됐으면 던진다. */
export async function discoverEndpoints(
    address: string,
    fetchImpl: FetchLike = fetch as unknown as FetchLike,
    timeoutMs: number = DESKTOP_CONFIG_TIMEOUT_MS,
): Promise<ServerEndpoints> {
    const entered = normalizeServerAddress(address);
    if (!entered) throw new Error(`서버 주소가 올바르지 않습니다: ${address}`);
    let config: unknown = null;
    try {
        const res = await fetchImpl(`${entered}${DESKTOP_CONFIG_PATH}`, { signal: AbortSignal.timeout(timeoutMs) });
        if (res.ok) config = ((await res.json()) as { data?: unknown } | null)?.data ?? null;
    } catch {
        /* 구버전 서버·연결 실패 — 넣은 주소를 그대로 쓴다 */
    }
    return resolveEndpoints(entered, config);
}
