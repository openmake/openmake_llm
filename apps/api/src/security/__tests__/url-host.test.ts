/**
 * 감사용 URL host 헬퍼(security/url-host) — MCP 서버 감사·외부 키 base_url·웹 스크래퍼 SSRF 감사가 같이 쓴다(#1476).
 * 종전 세 사본(urlHost·baseUrlHost·safeHost)과 같은 결과: host(포트 포함)만, 파싱 실패는 'invalid'.
 */
import { auditUrlHost } from '../url-host';

describe('auditUrlHost', () => {
    it('host 와 포트만 남기고 경로·쿼리·계정·프래그먼트는 버린다', () => {
        expect(auditUrlHost('https://user:pw@api.example.com:8443/v1/x?key=secret#f')).toBe('api.example.com:8443');
        expect(auditUrlHost('http://10.0.0.1/')).toBe('10.0.0.1');
        expect(auditUrlHost('https://Example.COM')).toBe('example.com');
    });

    it('기본 포트는 생략된다(URL.host 그대로)', () => {
        expect(auditUrlHost('https://example.com:443/a')).toBe('example.com');
    });

    it("파싱할 수 없으면 'invalid'", () => {
        expect(auditUrlHost('not a url')).toBe('invalid');
        expect(auditUrlHost('')).toBe('invalid');
        expect(auditUrlHost('//no-scheme.example.com')).toBe('invalid');
    });

    it("문자열이 아닌 값은 문자열로 바꿔 판정한다 — undefined·null·숫자는 'invalid'", () => {
        expect(auditUrlHost(undefined)).toBe('invalid');
        expect(auditUrlHost(null)).toBe('invalid');
        expect(auditUrlHost(42)).toBe('invalid');
        expect(auditUrlHost(new URL('https://obj.example.com/p'))).toBe('obj.example.com');
    });

    it('host 가 빈 URL 스킴은 빈 문자열(종전 new URL(x).host 와 같음)', () => {
        expect(auditUrlHost('file:///etc/passwd')).toBe('');
        expect(auditUrlHost('data:text/plain,hi')).toBe('');
    });
});
