/** base_url 정규화·비교 헬퍼 — 게이트웨이 라우팅과 capability 배정이 같은 규칙을 쓴다 */
import { normalizeBaseUrl, baseUrlHost, isCustomBaseUrl } from '../base-url';

describe('normalizeBaseUrl', () => {
    it('끝 / 를 지우고 scheme·host 를 소문자로', () => {
        expect(normalizeBaseUrl('https://OpenRouter.AI/api/v1/')).toBe('https://openrouter.ai/api/v1');
        expect(normalizeBaseUrl('  https://openrouter.ai/api/v1//  ')).toBe('https://openrouter.ai/api/v1');
    });

    it('쿼리는 보존한다', () => {
        expect(normalizeBaseUrl('https://example.com/v1/?a=1')).toBe('https://example.com/v1?a=1');
    });

    it('URL 파싱 실패 시 원문 trim + 끝 / 제거', () => {
        expect(normalizeBaseUrl(' not a url/ ')).toBe('not a url');
    });
});

describe('baseUrlHost', () => {
    it('host 만 돌려준다', () => {
        expect(baseUrlHost('https://proxy.example.com:8443/v1?key=secret')).toBe('proxy.example.com:8443');
    });

    it('파싱 실패는 (invalid)', () => {
        expect(baseUrlHost('nope')).toBe('(invalid)');
    });
});

describe('isCustomBaseUrl', () => {
    it('null·undefined·빈 값은 false', () => {
        expect(isCustomBaseUrl('openrouter', null)).toBe(false);
        expect(isCustomBaseUrl('openrouter', undefined)).toBe(false);
        expect(isCustomBaseUrl('openrouter', '')).toBe(false);
    });

    it('공백만 있는 값은 기본값과 다른 값으로 본다(종전 provider-router 비교와 같다)', () => {
        expect(isCustomBaseUrl('openrouter', '   ')).toBe(true);
    });

    it('카탈로그 기본값과 같으면(끝 / · 대소문자 차이 포함) false', () => {
        expect(isCustomBaseUrl('openrouter', 'https://openrouter.ai/api/v1')).toBe(false);
        expect(isCustomBaseUrl('openrouter', 'https://OPENROUTER.ai/api/v1/')).toBe(false);
    });

    it('다른 host 면 true', () => {
        expect(isCustomBaseUrl('openrouter', 'https://proxy.example.com/api/v1')).toBe(true);
    });

    it('카탈로그에 defaultBaseUrl 이 없으면(미등록 provider) false', () => {
        expect(isCustomBaseUrl('no-such-provider', 'https://proxy.example.com/v1')).toBe(false);
    });
});
