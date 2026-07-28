import { isBlockedIP } from '../security/ssrf-guard';

describe('SSRF isBlockedIP — mapped IPv6 우회 + 예약 대역 회귀', () => {
    const blocked: [string, string][] = [
        ['::ffff:127.0.0.1', 'mapped loopback 점표기'],
        ['::ffff:7f00:1', 'mapped loopback URL 정규화 hex 형태'],
        ['::ffff:10.0.0.5', 'mapped private 점표기'],
        ['::ffff:a00:5', 'mapped private hex'],
        ['::ffff:c0a8:101', 'mapped 192.168.1.1 hex'],
        ['::7f00:1', 'IPv4-compatible loopback'],
        ['100.64.0.1', 'CGNAT/Tailscale 하한'],
        ['100.127.255.254', 'CGNAT/Tailscale 상한'],
        ['::ffff:6440:1', 'mapped CGNAT hex'],
        ['198.18.0.1', '벤치마킹 대역'],
        ['192.0.0.1', 'IETF protocol 대역'],
        ['224.0.0.1', '멀티캐스트'],
        ['240.0.0.1', '예약(240/4)'],
        ['127.0.0.1', 'loopback'],
        ['10.1.2.3', 'private'],
        ['::1', 'IPv6 loopback'],
        ['fc00::1', 'IPv6 ULA'],
        ['fe80::1', 'IPv6 link-local'],
    ];

    const allowed: [string, string][] = [
        ['8.8.8.8', '공인 DNS'],
        ['1.1.1.1', '공인 DNS'],
        ['93.184.216.34', '공인 웹'],
        ['2606:4700:4700::1111', 'Cloudflare 공인 IPv6'],
        ['101.0.0.1', '100.64/10 바로 바깥'],
    ];

    it.each(blocked)('차단: %s (%s)', (ip) => {
        expect(isBlockedIP(ip)).toBe(true);
    });

    it.each(allowed)('허용(오탐 방지): %s (%s)', (ip) => {
        expect(isBlockedIP(ip)).toBe(false);
    });
});
