/**
 * 브라우저 정책 차단 표식 — 기기가 막은 호출의 종류·호스트를 서버 감사 기록용으로 돌려준다(2026-10-06).
 * URL 전체·입력 내용은 싣지 않는다(호스트만).
 */
import { browserPolicyBlockOf, userControlPolicyBlock } from '../browser/policy-block';

const policy = { allow: ['groupware.example.co.kr', '*.intra.example.co.kr'], deny: ['pay.intra.example.co.kr'] };

describe('browserPolicyBlockOf', () => {
    it('허용 목록 밖 사이트의 입력은 site_off_list — 호스트와 동작 종류만 싣는다', () => {
        const b = browserPolicyBlockOf({ type: 'fill', selector: '#q', text: '비밀 자료' }, 'news.example.com', policy);
        expect(b).toEqual({ kind: 'site_off_list', host: 'news.example.com', action: 'fill' });
        expect(JSON.stringify(b)).not.toContain('비밀 자료');
    });

    it('거부 목록 사이트의 누르기는 site_denied', () => {
        expect(browserPolicyBlockOf({ type: 'click', selector: '#pay' }, 'pay.intra.example.co.kr', policy))
            .toEqual({ kind: 'site_denied', host: 'pay.intra.example.co.kr', action: 'click' });
    });

    it('목록 밖 사이트로 질의 문자열을 실은 이동은 목적지 호스트만 싣는다(주소 전체·검색어 없음)', () => {
        const b = browserPolicyBlockOf({ type: 'goto', url: 'https://search.example.com/?q=고객명' }, 'groupware.example.co.kr', policy);
        expect(b).toEqual({ kind: 'site_off_list', host: 'search.example.com', action: 'goto' });
        expect(JSON.stringify(b)).not.toContain('고객명');
    });

    it('http(s) 가 아닌 주소로의 이동은 blocked_url — 주소는 싣지 않는다', () => {
        const b = browserPolicyBlockOf({ type: 'goto', url: 'file:///etc/hosts' }, null, policy);
        expect(b).toEqual({ kind: 'blocked_url', host: null, action: 'goto' });
    });

    it('주소를 알 수 없는 페이지의 입력은 호스트 null', () => {
        expect(browserPolicyBlockOf({ type: 'press', key: 'Enter' }, null, policy)).toEqual({ kind: 'site_off_list', host: null, action: 'press' });
    });

    it('동작 종류가 문자열이 아니면 unknown', () => {
        expect(browserPolicyBlockOf({ type: 42 }, 'a.com', policy).action).toBe('unknown');
    });
});

describe('userControlPolicyBlock', () => {
    it('사용자 제어 거절은 호스트 없이 동작 종류만', () => {
        expect(userControlPolicyBlock({ type: 'goto', url: 'https://a.com/?q=x' })).toEqual({ kind: 'user_control', host: null, action: 'goto' });
        expect(userControlPolicyBlock(undefined)).toEqual({ kind: 'user_control', host: null, action: 'unknown' });
    });
});
