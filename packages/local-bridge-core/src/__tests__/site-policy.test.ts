/**
 * 브라우저 사이트 정책(@openmake/config) — 서버와 기기가 같이 쓰는 판정. 기기 쪽 테스트 묶음에서 고정한다.
 */
import {
    browserActionNeedsApproval, browserHostMatches, browserHostOf, checkBrowserAction, classifyBrowserAction,
    isBrowserHostAllowed, isNavigableBrowserUrl, parseBrowserSitePolicy, planBrowserActions,
} from '@openmake/config';

const policy = { allow: ['groupware.example.co.kr', '*.intra.example.co.kr'], deny: ['pay.intra.example.co.kr'] };
const none = { allow: [], deny: [] };

describe('분류', () => {
    it('읽기·이동·쓰기·누르기를 나눈다', () => {
        for (const t of ['snapshot', 'extractText', 'extractHtml', 'screenshot', 'wait', 'waitFor']) expect(classifyBrowserAction({ type: t })).toBe('observe');
        expect(classifyBrowserAction({ type: 'goto', url: 'https://a.com' })).toBe('navigate');
        for (const t of ['fill', 'smartFill', 'press']) expect(classifyBrowserAction({ type: t })).toBe('write');
        for (const t of ['click', 'smartClick']) expect(classifyBrowserAction({ type: t })).toBe('click');
    });
    it('확인창은 수락만 쓰기다', () => {
        expect(classifyBrowserAction({ type: 'dialog', accept: true })).toBe('write');
        expect(classifyBrowserAction({ type: 'dialog', accept: false })).toBe('observe');
        expect(classifyBrowserAction({ type: 'dialog' })).toBe('observe');
    });
    it('모르는 액션·형태가 깨진 액션은 쓰기로 본다', () => {
        expect(classifyBrowserAction({ type: 'uploadFile' })).toBe('write');
        expect(classifyBrowserAction(null)).toBe('write');
        expect(classifyBrowserAction('click')).toBe('write');
    });
});

describe('호스트', () => {
    it('http(s) 만 호스트가 있다', () => {
        expect(browserHostOf('https://Groupware.Example.co.kr/a?b=1')).toBe('groupware.example.co.kr');
        expect(browserHostOf('http://10.0.0.5:8080/')).toBe('10.0.0.5');
        expect(browserHostOf('file:///etc/passwd')).toBeNull();
        expect(browserHostOf('javascript:alert(1)')).toBeNull();
        expect(browserHostOf('not a url')).toBeNull();
    });
    it('이동할 수 있는 주소는 http(s) 와 빈 페이지뿐', () => {
        expect(isNavigableBrowserUrl('https://a.com')).toBe(true);
        expect(isNavigableBrowserUrl('about:blank')).toBe(true);
        for (const u of ['file:///Users/x/secret.txt', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'chrome://settings', '', undefined]) {
            expect(isNavigableBrowserUrl(u)).toBe(false);
        }
    });
    it('패턴 — 정확 일치와 하위 도메인', () => {
        expect(browserHostMatches('groupware.example.co.kr', 'groupware.example.co.kr')).toBe(true);
        expect(browserHostMatches('evil-groupware.example.co.kr', 'groupware.example.co.kr')).toBe(false);
        expect(browserHostMatches('hr.intra.example.co.kr', '*.intra.example.co.kr')).toBe(true);
        expect(browserHostMatches('intra.example.co.kr', '*.intra.example.co.kr')).toBe(false);
        expect(browserHostMatches('intra.example.co.kr.evil.com', '*.intra.example.co.kr')).toBe(false);
        expect(browserHostMatches('a.com', '')).toBe(false);
    });
    it('점은 글자 그대로 — 정규식 문자로 새지 않는다', () => {
        expect(browserHostMatches('groupwareXexample.co.kr', 'groupware.example.co.kr')).toBe(false);
    });
    it('허용 — 거부가 이기고, 빈 목록이면 아무 곳도 허용하지 않는다', () => {
        expect(isBrowserHostAllowed('hr.intra.example.co.kr', policy)).toBe(true);
        expect(isBrowserHostAllowed('pay.intra.example.co.kr', policy)).toBe(false);
        expect(isBrowserHostAllowed('google.com', policy)).toBe(false);
        expect(isBrowserHostAllowed('groupware.example.co.kr', none)).toBe(false);
        expect(isBrowserHostAllowed(null, policy)).toBe(false);
    });
});

describe('승인 필요 판정', () => {
    it('읽기는 어디서든 승인이 필요 없다', () => {
        expect(browserActionNeedsApproval({ type: 'extractText' }, 'google.com', none)).toBeNull();
    });
    it('목록 밖 사이트의 입력·누르기는 승인이 필요하다', () => {
        expect(browserActionNeedsApproval({ type: 'fill', selector: '#q', text: 'x' }, 'google.com', policy)).toBe('google.com');
        expect(browserActionNeedsApproval({ type: 'click', selector: 'a' }, 'google.com', policy)).toBe('google.com');
    });
    it('허용 목록 사이트에서는 필요 없다', () => {
        expect(browserActionNeedsApproval({ type: 'fill', selector: '#q', text: 'x' }, 'groupware.example.co.kr', policy)).toBeNull();
    });
    it('이동 — 질의 문자열 없이 목록 밖으로 가는 것은 읽기, 있으면 쓰기(검색)', () => {
        expect(browserActionNeedsApproval({ type: 'goto', url: 'https://news.example.com/article/1' }, null, policy)).toBeNull();
        expect(browserActionNeedsApproval({ type: 'goto', url: 'https://www.google.com/search?q=고객명' }, null, policy)).toBe('www.google.com');
        expect(browserActionNeedsApproval({ type: 'goto', url: 'https://www.google.com/?' }, null, policy)).toBeNull();
        expect(browserActionNeedsApproval({ type: 'goto', url: 'https://groupware.example.co.kr/list?page=2' }, null, policy)).toBeNull();
    });
    it('현재 주소를 모르는 쓰기는 승인이 필요하다(호스트는 빈 문자열)', () => {
        expect(browserActionNeedsApproval({ type: 'press', key: 'Enter' }, null, policy)).toBe('');
    });
});

describe('planBrowserActions (서버)', () => {
    it('goto 를 따라 호스트를 바꿔 가며 목록 밖 쓰기를 찾는다', () => {
        const plan = planBrowserActions([
            { type: 'goto', url: 'https://groupware.example.co.kr/write' },
            { type: 'fill', selector: '#title', text: '보고' },
            { type: 'goto', url: 'https://translate.example.com/' },
            { type: 'fill', selector: 'textarea', text: '사내 문서 문장' },
            { type: 'extractText' },
            { type: 'click', selector: '#go' },
        ], null, policy);
        expect(plan.blocked).toEqual([]);
        expect(plan.offListWrites.map((w) => [w.index, w.type, w.host])).toEqual([[3, 'fill', 'translate.example.com'], [5, 'click', 'translate.example.com']]);
        expect(plan.offListWrites[0].detail).toContain('사내 문서 문장');
    });
    it('시작 주소(서버가 아는 마지막 주소)에서 이어지는 쓰기를 판정한다', () => {
        expect(planBrowserActions([{ type: 'fill', selector: '#a', text: 'x' }], 'https://groupware.example.co.kr/', policy).offListWrites).toEqual([]);
        expect(planBrowserActions([{ type: 'fill', selector: '#a', text: 'x' }], 'https://other.com/', policy).offListWrites).toHaveLength(1);
    });
    it('http(s) 가 아닌 이동은 막는다 — 승인 대상이 아니다', () => {
        const plan = planBrowserActions([{ type: 'goto', url: 'file:///Users/me/.ssh/id_rsa' }, { type: 'extractText' }], null, policy);
        expect(plan.blocked).toEqual([{ index: 0, url: 'file:///Users/me/.ssh/id_rsa' }]);
    });
    it('긴 입력은 잘라서 싣는다', () => {
        const plan = planBrowserActions([{ type: 'fill', selector: '#a', text: 'x'.repeat(5000) }], 'https://other.com/', policy);
        expect(plan.offListWrites[0].detail.length).toBeLessThan(300);
    });
});

describe('checkBrowserAction (기기)', () => {
    it('승인된 호스트의 쓰기는 통과한다', () => {
        expect(checkBrowserAction({ type: 'fill', selector: '#a', text: 'x' }, 'translate.example.com', policy, ['translate.example.com'])).toBeNull();
    });
    it('실제 탭이 승인된 호스트와 다르면 막는다 (리다이렉트·사용자 조작)', () => {
        const r = checkBrowserAction({ type: 'fill', selector: '#a', text: 'x' }, 'phishing.example.net', policy, ['translate.example.com']);
        expect(r).toContain('phishing.example.net');
    });
    it('호스트를 모른 채 받은 승인("")은 어떤 사이트도 통과시키지 않는다', () => {
        expect(checkBrowserAction({ type: 'click', selector: 'a' }, 'other.com', policy, [''])).not.toBeNull();
        expect(checkBrowserAction({ type: 'press', key: 'Enter' }, null, policy, [''])).not.toBeNull();
    });
    it('허용 목록 사이트와 읽기는 승인 없이 통과한다', () => {
        expect(checkBrowserAction({ type: 'click', selector: 'a' }, 'hr.intra.example.co.kr', policy, [])).toBeNull();
        expect(checkBrowserAction({ type: 'extractText' }, 'anything.com', policy, [])).toBeNull();
    });
    it('http(s) 가 아닌 이동은 승인이 있어도 막는다', () => {
        expect(checkBrowserAction({ type: 'goto', url: 'file:///etc/hosts' }, null, policy, ['', 'localhost'])).toContain('이동할 수 없는 주소');
    });
});

describe('parseBrowserSitePolicy', () => {
    it('JSON 문자열·객체를 받고 소문자로 정리한다', () => {
        expect(parseBrowserSitePolicy('{"allow":["A.com"," "],"deny":["b.com"]}')).toEqual({ allow: ['a.com'], deny: ['b.com'] });
        expect(parseBrowserSitePolicy({ allow: ['x.com'] })).toEqual({ allow: ['x.com'], deny: [] });
    });
    it('형태가 어긋나면 빈 정책 — 전부 승인 대상', () => {
        for (const v of ['', '{', '[]', 42, null, undefined, { allow: 'a.com' }]) expect(parseBrowserSitePolicy(v)).toEqual({ allow: [], deny: [] });
    });
});
