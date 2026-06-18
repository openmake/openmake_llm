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
    '0.0.0.0/8'
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

function extractIPv4FromMappedIPv6(address: string): string | null {
    const lowerAddress = address.toLowerCase();
    if (!lowerAddress.startsWith('::ffff:')) {
        return null;
    }

    const ipv4Part = lowerAddress.slice('::ffff:'.length);
    return isIP(ipv4Part) === 4 ? ipv4Part : null;
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

export async function validateOutboundUrl(rawUrl: string, resolver: DnsResolver = dns.lookup): Promise<URL> {
    const url = new URL(rawUrl);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        const message = `SSRF blocked: scheme not allowed: ${url.protocol}`;
        logger.warn(message, { rawUrl });
        throw new Error(message);
    }

    const { address } = await resolver(url.hostname);
    if (isBlockedIP(address)) {
        const message = `SSRF blocked: resolved to blocked IP range: ${address}`;
        logger.warn(message, { rawUrl, hostname: url.hostname, address });
        throw new Error(message);
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
            const message = `SSRF blocked: resolved to blocked IP range: ${address}`;
            logger.warn(message, { rawUrl: currentUrl, hostname: url.hostname, address });
            throw new Error(message);
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
