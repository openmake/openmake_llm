/**
 * SSRF allowlist 의 `host:port` 최소 권한 형태.
 *
 * 로컬 streamable-http MCP(예: searxng 127.0.0.1:8889)를 쓰려면 loopback 을 열어야 하는데,
 * 호스트 단위로 열면 DB·Redis·LLM 게이트웨이 등 다른 내부 포트까지 함께 뚫린다.
 * 포트를 명시하면 그 포트만 허용된다 (2026-08-18).
 */
import { isAllowlistedHost, effectivePort } from '../security/ssrf-guard';

const ORIGINAL = process.env.SSRF_ALLOWED_HOSTS;

afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.SSRF_ALLOWED_HOSTS;
    else process.env.SSRF_ALLOWED_HOSTS = ORIGINAL;
});

describe('SSRF allowlist host:port', () => {
    it('명시한 포트만 허용하고 다른 내부 포트는 계속 막는다', () => {
        process.env.SSRF_ALLOWED_HOSTS = '127.0.0.1:8889';
        expect(isAllowlistedHost('127.0.0.1', '127.0.0.1', '8889')).toBe(true);
        expect(isAllowlistedHost('127.0.0.1', '127.0.0.1', '5432')).toBe(false); // DB
        expect(isAllowlistedHost('127.0.0.1', '127.0.0.1', '13401')).toBe(false); // LLM 게이트웨이
        expect(isAllowlistedHost('127.0.0.1', '127.0.0.1', undefined)).toBe(false);
    });

    it('포트를 생략한 항목은 종전대로 전 포트를 허용한다 (하위 호환)', () => {
        process.env.SSRF_ALLOWED_HOSTS = '192.168.0.45';
        expect(isAllowlistedHost('192.168.0.45', '192.168.0.45', '11434')).toBe(true);
        expect(isAllowlistedHost('192.168.0.45', '192.168.0.45', '22')).toBe(true);
    });

    it('hostname 항목에도 포트를 붙일 수 있다', () => {
        process.env.SSRF_ALLOWED_HOSTS = 'rag.internal:8080';
        expect(isAllowlistedHost('rag.internal', '10.0.0.5', '8080')).toBe(true);
        expect(isAllowlistedHost('rag.internal', '10.0.0.5', '9000')).toBe(false);
    });

    it('CIDR 항목은 포트 개념 없이 종전대로 동작한다', () => {
        process.env.SSRF_ALLOWED_HOSTS = '10.1.0.0/16';
        expect(isAllowlistedHost('10.1.2.3', '10.1.2.3', '5432')).toBe(true);
    });

    it('미설정이면 여전히 fail-closed', () => {
        process.env.SSRF_ALLOWED_HOSTS = '';
        expect(isAllowlistedHost('127.0.0.1', '127.0.0.1', '8889')).toBe(false);
    });

    it('effectivePort 는 스킴 기본 포트를 채운다', () => {
        expect(effectivePort(new URL('http://a.test/x'))).toBe('80');
        expect(effectivePort(new URL('https://a.test/x'))).toBe('443');
        expect(effectivePort(new URL('http://a.test:8889/mcp'))).toBe('8889');
    });
});
