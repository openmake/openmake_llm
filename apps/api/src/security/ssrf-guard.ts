import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';
import { createLogger } from '../utils/logger';
import { SSRF_LIMITS } from '../config/security';

const logger = createLogger('SSRFGuard');

const BLOCKED_IPV4_CIDRS = [
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    '127.0.0.0/8',
    '169.254.0.0/16',
    '0.0.0.0/8',
    '100.64.0.0/10',   // CGNAT (RFC6598) — 이 배포의 Tailscale 테일넷 대역 포함
    '192.0.0.0/24',    // IETF protocol assignments (RFC6890)
    '198.18.0.0/15',   // 벤치마킹 (RFC2544)
    '224.0.0.0/3'      // 멀티캐스트(224/4) + 예약(240/4)
];

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export type DnsResolver = (hostname: string) => Promise<{ address: string }>;

function ipToNumber(ip: string): number {
    const octets = ip.split('.').map(part => Number(part));
    if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
        throw new Error(`Invalid IPv4 address: ${ip}`);
    }

    return ((((octets[0] << 24) >>> 0) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0);
}

function parseCIDR(cidr: string): { base: number; prefixLength: number } {
    const [network, prefixPart] = cidr.split('/');
    const prefixLength = Number(prefixPart);

    if (!network || !Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) {
        throw new Error(`Invalid CIDR block: ${cidr}`);
    }

    return {
        base: ipToNumber(network),
        prefixLength
    };
}

function isInIPv4CIDR(ipNum: number, cidr: string): boolean {
    const { base, prefixLength } = parseCIDR(cidr);
    const mask = prefixLength === 0 ? 0 : ((0xffffffff << (32 - prefixLength)) >>> 0);
    return (ipNum & mask) === (base & mask);
}

/**
 * IPv6 주소를 16바이트 배열로 전개한다 (:: 압축·IPv4 점표기 tail 지원).
 * 유효하지 않으면 null. 호출 전 isIP()===6 으로 검증된 주소를 가정하되 방어적으로 파싱.
 */
function ipv6ToBytes(address: string): number[] | null {
    const addr = address.toLowerCase().split('%')[0];
    const halves = addr.split('::');
    if (halves.length > 2) {
        return null;
    }

    const parseGroups = (segment: string): number[] | null => {
        if (!segment) {
            return [];
        }
        const bytes: number[] = [];
        const groups = segment.split(':');
        for (let i = 0; i < groups.length; i += 1) {
            const group = groups[i];
            if (group.includes('.')) {
                // 마지막 그룹만 IPv4 점표기 허용 (예: ::ffff:127.0.0.1)
                if (i !== groups.length - 1 || isIP(group) !== 4) {
                    return null;
                }
                for (const octet of group.split('.')) {
                    bytes.push(Number(octet));
                }
            } else {
                if (!/^[0-9a-f]{1,4}$/.test(group)) {
                    return null;
                }
                const value = Number.parseInt(group, 16);
                bytes.push((value >> 8) & 0xff, value & 0xff);
            }
        }
        return bytes;
    };

    if (halves.length === 2) {
        const head = parseGroups(halves[0]);
        const tail = parseGroups(halves[1]);
        if (head === null || tail === null) {
            return null;
        }
        const missing = 16 - head.length - tail.length;
        if (missing < 0) {
            return null;
        }
        return [...head, ...new Array(missing).fill(0), ...tail];
    }

    const all = parseGroups(addr);
    return all && all.length === 16 ? all : null;
}

/**
 * IPv4-mapped(::ffff:0:0/96) 또는 IPv4-compatible(::/96) IPv6 에서 내장 IPv4 를 추출.
 * 점표기(::ffff:127.0.0.1)와 URL 파서가 정규화하는 hex 압축형(::ffff:7f00:1) 을 모두 처리한다.
 */
function extractIPv4FromMappedIPv6(address: string): string | null {
    if (isIP(address) !== 6) {
        return null;
    }
    const bytes = ipv6ToBytes(address);
    if (!bytes) {
        return null;
    }

    const first10Zero = bytes.slice(0, 10).every(b => b === 0);
    if (!first10Zero) {
        return null;
    }
    const isMapped = bytes[10] === 0xff && bytes[11] === 0xff;
    const isCompat = bytes[10] === 0 && bytes[11] === 0;
    if (!isMapped && !isCompat) {
        return null;
    }

    return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
}

function isBlockedIPv4(address: string): boolean {
    const ipNumber = ipToNumber(address);
    return BLOCKED_IPV4_CIDRS.some(cidr => isInIPv4CIDR(ipNumber, cidr));
}

export function isBlockedIP(address: string): boolean {
    const mappedIPv4 = extractIPv4FromMappedIPv6(address);
    if (mappedIPv4) {
        return isBlockedIPv4(mappedIPv4);
    }

    const version = isIP(address);

    if (version === 4) {
        return isBlockedIPv4(address);
    }

    if (version === 6) {
        const normalized = address.toLowerCase();
        if (normalized === '::1') {
            return true;
        }

        const firstSegmentRaw = normalized.split(':')[0];
        const firstSegment = Number.parseInt(firstSegmentRaw || '0', 16);

        if (!Number.isNaN(firstSegment)) {
            if (firstSegment >= 0xfc00 && firstSegment <= 0xfdff) {
                return true;
            }

            if (firstSegment >= 0xfe80 && firstSegment <= 0xfebf) {
                return true;
            }
        }

        return false;
    }

    return true;
}

/**
 * 신뢰 호스트 허용목록 (SSRF_ALLOWED_HOSTS).
 *
 * 셀프호스팅 환경에서 사내 RAG 서버·LAN 의 vLLM 처럼 사설망 대역에 있는 "신뢰" 서비스를
 * 외부 프로바이더 base_url / MCP 서버 URL 로 등록할 수 있도록, 차단 대상 IP 라도 명시적으로
 * 허용목록에 있으면 통과시킨다.
 *
 * 형식: 콤마 구분. 각 항목은 ① hostname(정확 일치) ② IPv4 ③ IPv4 CIDR.
 *   예) SSRF_ALLOWED_HOSTS=rag.internal,192.168.0.45,10.1.0.0/16
 *
 * ⚠️ 미설정(빈 값) 시 항상 false — 기존 차단 동작과 100% 동일(fail-closed). 즉 이 기능은
 *    opt-in 이며, 설정하지 않는 한 기본 보안 경계는 변하지 않는다.
 */
type AllowlistEntry =
    | { kind: 'hostname'; value: string }
    | { kind: 'ipv4'; value: string }
    | { kind: 'cidr'; value: string };

let allowlistCache: { raw: string; entries: AllowlistEntry[] } | null = null;

function parseAllowlist(): AllowlistEntry[] {
    const raw = process.env.SSRF_ALLOWED_HOSTS ?? '';
    if (allowlistCache && allowlistCache.raw === raw) {
        return allowlistCache.entries;
    }

    const entries: AllowlistEntry[] = [];
    for (const tokenRaw of raw.split(',')) {
        const token = tokenRaw.trim();
        if (!token) {
            continue;
        }
        if (token.includes('/')) {
            try {
                parseCIDR(token); // 유효성 검증 (실패 시 throw)
                entries.push({ kind: 'cidr', value: token });
            } catch {
                logger.warn('SSRF allowlist: invalid CIDR ignored', { token });
            }
        } else if (isIP(token) === 4) {
            entries.push({ kind: 'ipv4', value: token });
        } else {
            entries.push({ kind: 'hostname', value: token.toLowerCase() });
        }
    }

    allowlistCache = { raw, entries };
    return entries;
}

/**
 * URL 의 hostname 또는 resolved 주소가 SSRF_ALLOWED_HOSTS 허용목록에 있으면 true.
 * 미설정 시 항상 false (fail-closed).
 */
export function isAllowlistedHost(hostname: string, address: string): boolean {
    const entries = parseAllowlist();
    if (entries.length === 0) {
        return false;
    }

    const host = hostname.toLowerCase();
    const addressIsIPv4 = isIP(address) === 4;
    const hostnameIsIPv4 = isIP(hostname) === 4;

    for (const entry of entries) {
        if (entry.kind === 'hostname') {
            if (host === entry.value) {
                return true;
            }
        } else if (entry.kind === 'ipv4') {
            if (address === entry.value || hostname === entry.value) {
                return true;
            }
        } else {
            try {
                if (addressIsIPv4 && isInIPv4CIDR(ipToNumber(address), entry.value)) {
                    return true;
                }
                if (hostnameIsIPv4 && isInIPv4CIDR(ipToNumber(hostname), entry.value)) {
                    return true;
                }
            } catch {
                // 파싱 실패는 매칭 실패로 취급 (fail-closed)
            }
        }
    }

    return false;
}

export async function validateOutboundUrl(rawUrl: string, resolver: DnsResolver = dns.lookup): Promise<URL> {
    const url = new URL(rawUrl);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        const message = `SSRF blocked: scheme not allowed: ${url.protocol}`;
        logger.warn(message, { rawUrl });
        throw new Error(message);
    }

    const { address } = await resolver(url.hostname);
    if (isBlockedIP(address)) {
        if (isAllowlistedHost(url.hostname, address)) {
            logger.info('SSRF allowlist bypass: host explicitly allowed', { rawUrl, hostname: url.hostname, address });
        } else {
            const message = `SSRF blocked: resolved to blocked IP range: ${address}`;
            logger.warn(message, { rawUrl, hostname: url.hostname, address });
            throw new Error(message);
        }
    }

    return url;
}

/**
 * undici Agent with pinned connect.lookup — DNS Rebinding 방어.
 *
 * URL의 hostname은 유지되어 TLS SNI/인증서 검증이 정상 동작하며,
 * 실제 connect() 시점에만 고정 IP를 사용해 TOCTOU 공격을 차단한다.
 *
 * @internal
 */
function createPinnedAgent(pinnedAddress: string, ipFamily: 4 | 6): Agent {
    return new Agent({
        connect: {
            lookup: (_hostname, options, callback) => {
                // Node 24 undici는 happy-eyeballs 연결을 위해 all:true 로 lookup 을
                // 호출하고 LookupAddress 배열을 기대한다 — 단일 (address, family) 형태로만
                // 응답하면 "Invalid IP address: undefined" 로 모든 연결이 실패한다.
                if (options?.all) {
                    callback(null, [{ address: pinnedAddress, family: ipFamily }], ipFamily);
                } else {
                    callback(null, pinnedAddress, ipFamily);
                }
            },
        },
    });
}

export async function safeFetch(
    rawUrl: string,
    init?: RequestInit,
    resolver: DnsResolver = dns.lookup
): Promise<Response> {
    let currentUrl = rawUrl;

    for (let redirectCount = 0; redirectCount < SSRF_LIMITS.MAX_REDIRECTS; redirectCount += 1) {
        const url = new URL(currentUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            const message = `SSRF blocked: scheme not allowed: ${url.protocol}`;
            logger.warn(message, { rawUrl: currentUrl });
            throw new Error(message);
        }

        const { address } = await resolver(url.hostname);
        if (isBlockedIP(address)) {
            if (isAllowlistedHost(url.hostname, address)) {
                logger.info('SSRF allowlist bypass: host explicitly allowed', { rawUrl: currentUrl, hostname: url.hostname, address });
            } else {
                const message = `SSRF blocked: resolved to blocked IP range: ${address}`;
                logger.warn(message, { rawUrl: currentUrl, hostname: url.hostname, address });
                throw new Error(message);
            }
        }

        // DNS Rebinding 방어: undici Agent의 connect.lookup으로 resolved IP를 고정.
        // URL hostname이 보존되므로 HTTPS SNI/인증서 검증이 정상 동작.
        const ipFamily: 4 | 6 = isIP(address) === 6 ? 6 : 4;
        const dispatcher = createPinnedAgent(address, ipFamily);

        const response = await fetch(currentUrl, {
            ...init,
            redirect: 'manual',
            // @ts-expect-error undici-specific dispatcher option supported by Node 22 fetch
            dispatcher,
        });

        const location = response.headers.get('location');
        if (REDIRECT_STATUS_CODES.has(response.status) && location) {
            currentUrl = new URL(location, currentUrl).toString();
            continue;
        }

        return response;
    }

    logger.warn('SSRF blocked: too many redirects', { rawUrl, maxRedirects: SSRF_LIMITS.MAX_REDIRECTS });
    throw new Error('SSRF blocked: too many redirects');
}
