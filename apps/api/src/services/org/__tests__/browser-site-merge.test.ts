/**
 * 사이트 허용 목록 병합 (Companion P2) — 전역 ⊕ 조직.
 */
import { mergeBrowserSitePolicy } from '../effective-policy';

describe('mergeBrowserSitePolicy', () => {
    const g = { allow: ['groupware.example.co.kr', 'erp.example.co.kr'], deny: ['pay.example.co.kr'] };
    it('조직 정책이 없으면 전역 그대로', () => {
        expect(mergeBrowserSitePolicy(g)).toBe(g);
    });
    it('deny 는 합집합, allow 는 둘 다 있으면 교집합', () => {
        expect(mergeBrowserSitePolicy(g, { allow: ['erp.example.co.kr', 'other.example.com'], deny: ['x.example.com'] }))
            .toEqual({ allow: ['erp.example.co.kr'], deny: ['pay.example.co.kr', 'x.example.com'] });
    });
    it('교집합이 비면 빈 목록 — 모든 입력이 승인 대상', () => {
        expect(mergeBrowserSitePolicy(g, { allow: ['other.example.com'], deny: [] }).allow).toEqual([]);
    });
    it('한쪽만 allow 가 있으면 그쪽', () => {
        expect(mergeBrowserSitePolicy({ allow: [], deny: [] }, { allow: ['a.example.com'], deny: [] }).allow).toEqual(['a.example.com']);
        expect(mergeBrowserSitePolicy(g, { allow: [], deny: [] }).allow).toEqual(g.allow);
    });
});
