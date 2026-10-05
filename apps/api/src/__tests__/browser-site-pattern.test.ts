/**
 * 브라우저 사이트 정책 — 관리자 편집기·시스템 설정 저장이 같이 쓰는 패턴 검증(@openmake/config).
 * 판정(browserHostMatches)과 같은 규칙: 호스트 이름 또는 맨 앞 라벨 하나만 `*` 인 패턴.
 */
import {
    BROWSER_SITE_POLICY_MAX_JSON_CHARS, browserHostMatches, browserSitePolicyProblems, normalizeBrowserSitePattern,
} from '@openmake/config';
import { SETTING_DEFS_BY_KEY } from '../config/system-settings-registry';

const ok = (input: string) => normalizeBrowserSitePattern(input);

describe('normalizeBrowserSitePattern — 받아들이는 입력', () => {
    it.each([
        ['groupware.example.co.kr', 'groupware.example.co.kr'],
        ['  GroupWare.Example.CO.KR ', 'groupware.example.co.kr'],
        ['*.example.co.kr', '*.example.co.kr'],
        ['localhost', 'localhost'],
        ['intranet', 'intranet'],
        ['192.168.0.10', '192.168.0.10'],
        ['xn--3e0b707e.kr', 'xn--3e0b707e.kr'],
        ['my-site.example.com.', 'my-site.example.com'],
    ])('%s → %s', (input, pattern) => {
        expect(ok(input)).toEqual({ ok: true, pattern });
    });

    it.each([
        ['https://groupware.example.co.kr/login?x=1', 'groupware.example.co.kr'],
        ['http://Example.com:8080', 'example.com'],
        ['example.com/path/to', 'example.com'],
        ['example.com:443', 'example.com'],
        ['https://*.example.com/', '*.example.com'],
        ['example.com#frag', 'example.com'],
    ])('스킴·포트·경로는 떼고 호스트만 남긴다: %s → %s', (input, pattern) => {
        expect(ok(input)).toEqual({ ok: true, pattern });
    });
});

describe('normalizeBrowserSitePattern — 거절하는 입력', () => {
    it.each([
        ['', 'empty'],
        ['   ', 'empty'],
        ['ftp://example.com', 'scheme'],
        ['file:///etc/passwd', 'scheme'],
        ['javascript:alert(1)', 'scheme'],
        ['https://user:pw@example.com', 'userinfo'],
        ['user@example.com', 'userinfo'],
        ['*', 'wildcard'],
        ['*.com', 'wildcard'],
        ['*.*.example.com', 'wildcard'],
        ['ex*ample.com', 'wildcard'],
        ['example.*', 'wildcard'],
        ['**.example.com', 'wildcard'],
        ['exa mple.com', 'invalid'],
        ['-example.com', 'invalid'],
        ['example-.com', 'invalid'],
        ['example..com', 'invalid'],
        ['예시.kr', 'invalid'],
        ['[::1]', 'invalid'],
        ['example_site.com', 'invalid'],
        [`${'a'.repeat(64)}.com`, 'invalid'],
        [`${'abcdefghi.'.repeat(21)}com`, 'too_long'],
    ])('%s → %s', (input, error) => {
        expect(ok(input)).toEqual({ ok: false, error });
    });
});

describe('정규화한 패턴은 판정(browserHostMatches)과 맞물린다', () => {
    it('와일드카드는 하위 도메인만, 정확한 이름은 그 호스트만', () => {
        const wild = (ok('https://*.intra.example.co.kr/x') as { pattern: string }).pattern;
        expect(browserHostMatches('mail.intra.example.co.kr', wild)).toBe(true);
        expect(browserHostMatches('intra.example.co.kr', wild)).toBe(false);
        const exact = (ok('HTTPS://Groupware.Example.co.kr:8443/a') as { pattern: string }).pattern;
        expect(browserHostMatches('groupware.example.co.kr', exact)).toBe(true);
    });
});

describe('browserSitePolicyProblems — 저장 값 검증', () => {
    it('올바른 정책은 문제가 없다', () => {
        expect(browserSitePolicyProblems('{"allow":["a.example.com","*.intra.example.co.kr"],"deny":["pay.intra.example.co.kr"]}')).toEqual([]);
        expect(browserSitePolicyProblems('{"allow":[],"deny":[]}')).toEqual([]);
        expect(browserSitePolicyProblems('{"allow":["a.example.com"]}')).toEqual([]);
    });

    it('JSON 이 아니거나 형태가 어긋나면 문제', () => {
        expect(browserSitePolicyProblems('not json')).toEqual(['json']);
        expect(browserSitePolicyProblems('[]')).toEqual(['shape']);
        expect(browserSitePolicyProblems('{"allow":"a.com"}')).toEqual(['shape']);
        expect(browserSitePolicyProblems('{"allow":[],"extra":[]}')).toEqual(['shape']);
        expect(browserSitePolicyProblems('{"allow":[1]}')).toEqual(['shape']);
    });

    it('잘못된 패턴·정규화되지 않은 패턴·중복은 항목별로 알린다', () => {
        expect(browserSitePolicyProblems('{"allow":["ok.example.com","*.com"],"deny":["https://x.example.com"]}'))
            .toEqual(['allow[1] "*.com": wildcard', 'deny[0] "https://x.example.com": not_normalized']);
        expect(browserSitePolicyProblems('{"allow":["a.example.com","a.example.com"]}'))
            .toEqual(['allow[1] "a.example.com": duplicate']);
    });

    it('저장 값 길이 상한(시스템 설정 2000자)을 넘으면 문제', () => {
        const many = Array.from({ length: 100 }, (_, i) => `site-${i}.intra.example.co.kr`);
        const raw = JSON.stringify({ allow: many });
        expect(raw.length).toBeGreaterThan(BROWSER_SITE_POLICY_MAX_JSON_CHARS);
        expect(browserSitePolicyProblems(raw)).toEqual(['too_long']);
    });
});

describe('시스템 설정 BROWSER_SITE_POLICY 저장 검증', () => {
    const validate = SETTING_DEFS_BY_KEY.get('BROWSER_SITE_POLICY')!.validate;

    it('올바른 정책은 통과한다', () => {
        expect(validate.safeParse('{"allow":["groupware.example.co.kr"],"deny":[]}').success).toBe(true);
    });

    it('잘못된 패턴이 든 정책은 거절한다', () => {
        const r = validate.safeParse('{"allow":["*.com"],"deny":[]}');
        expect(r.success).toBe(false);
        if (!r.success) expect(r.error.issues[0].message).toContain('*.com');
    });

    it('형식이 어긋난 값(JSON 아님·모르는 키)은 거절한다', () => {
        expect(validate.safeParse('not json').success).toBe(false);
        expect(validate.safeParse('{"allowed":["a.example.com"]}').success).toBe(false);
    });
});
