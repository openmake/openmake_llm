/**
 * 봇 차단 감지(looksBotBlocked)의 오탐·미탐 표본 — 정상 페이지와 실제 차단 화면의 본문·HTML 을 고정해 둔다.
 * 표본은 각 서비스가 실제로 내보내는 화면의 문구를 줄여 옮긴 것이다(도메인·식별자는 지어낸 값).
 * "실측" 표시가 붙은 표본은 2026-10-04 에 그 주소를 실제로 받아 온 응답의 발췌다(식별자·토큰은 줄였다).
 * 실측에서 못 잡은 것: indeed.com 의 Cloudflare 확인 화면 — 제목이 사이트 고유 문구("Security Check - Indeed.com")이고
 * 차단 표지는 HTML 1만 4천 자 뒤에 있어 러너가 자른 앞 8천 자에 들어오지 않는다.
 */
import { looksBotBlocked } from './browser-result-guard';

const out = (r: { text?: string; html?: string }): string => JSON.stringify({
    ok: true, finalUrl: 'https://example.com/', results: [
        { i: 0, type: 'goto', ok: true, url: 'https://example.com/' },
        ...(r.text !== undefined ? [{ i: 1, type: 'extractText', ok: true, text: r.text }] : []),
        ...(r.html !== undefined ? [{ i: 2, type: 'extractHtml', ok: true, html: r.html }] : []),
    ],
});

/** 정상 페이지 — 경고가 붙으면 오탐이다. */
const NORMAL: Array<[string, { text?: string; html?: string }]> = [
    ['캡차를 설명하는 짧은 문서 글', {
        text: 'What is a CAPTCHA?\nA CAPTCHA is a type of challenge-response test used in computing to determine whether the user is human, '
            + 'in order to deter bot attacks and spam. The most common form asks the visitor to read distorted text or pick matching images. '
            + 'reCAPTCHA and hCaptcha are widely used services.',
        html: '<html><head><title>What is a CAPTCHA? - Help Center</title></head><body><h1>What is a CAPTCHA?</h1><p>A CAPTCHA is a test…</p></body></html>',
    }],
    ['캡차를 설명하는 한국어 글', {
        text: '캡차(CAPTCHA)란?\n캡차는 사람과 컴퓨터를 구별하기 위한 자동 테스트입니다. 회원가입 화면의 보안문자, 자동입력 방지 문자, '
            + '"로봇이 아닙니다" 확인란이 모두 캡차의 한 종류입니다.',
    }],
    ['"access denied" 오류를 다루는 안내 문서', {
        text: 'Access Denied errors explained\nAn "Access Denied" (HTTP 403) response means the server understood the request but refuses to authorize it. '
            + 'Common causes: missing permissions on the bucket, an expired token, or an IP allow list. '
            + 'To fix it, check the policy attached to your role and retry.',
        html: '<html><head><title>Access Denied errors explained | Docs</title></head><body><h1>Access Denied errors explained</h1></body></html>',
    }],
    ['로그인 페이지(reCAPTCHA 위젯 포함)', {
        text: 'Sign in\nEmail\nPassword\nI\'m not a robot\nreCAPTCHA\nPrivacy - Terms\nForgot password?\nCreate account',
        html: '<html><head><title>Sign in - Example</title><script src="https://www.google.com/recaptcha/api.js"></script></head>'
            + '<body><form><input name="email"><input type="password"><div class="g-recaptcha" data-sitekey="x"></div></form></body></html>',
    }],
    ['한국어 로그인 페이지(자동입력 방지)', {
        text: '로그인\n아이디\n비밀번호\n자동입력 방지 문자를 입력하세요\n로봇이 아닙니다\n아이디 찾기 | 비밀번호 찾기 | 회원가입',
    }],
    ['짧은 404 페이지', {
        text: '404 Not Found\nThe requested URL was not found on this server.',
        html: '<html><head><title>404 Not Found</title></head><body><h1>Not Found</h1></body></html>',
    }],
    ['짧은 로딩 문구', { text: 'Dashboard\nJust a moment, loading your projects…' }],
    ['실측: 차단 메시지를 설명하는 Google 고객센터 글(한국어) — 제목에 차단 화면의 문구가 인용돼 있다', {
        html: '<!doctype html><html class="hcfe" data-page-type="ANSWER" lang="ko"><head><title>Google 검색의 \'컴퓨터 네트워크에서 감지된 비정상적인 트래픽\' 메시지 해결하기 - Google 검색 고객센터</title>'
            + '<link href="/favicon.png" rel="shortcut icon" type="image/png"></head><body><h1>Google 검색의 \'컴퓨터 네트워크에서 감지된 비정상적인 트래픽\' 메시지 해결하기</h1></body></html>',
    }],
    ['실측: 같은 고객센터 글(영어)', {
        html: '<!doctype html><html class="hcfe" data-page-type="ANSWER" lang="en"><head><title>Resolve Google Search’s "Unusual traffic from your computer network" message - Google Search Help</title>'
            + '<link href="/favicon.png" rel="shortcut icon" type="image/png"></head><body><h1>Resolve Google Search’s "Unusual traffic from your computer network" message</h1></body></html>',
    }],
    ['실측: Cloudflare 뒤의 정상 페이지(nowsecure.nl) — 확인 화면이 아닌데도 끝에 Cloudflare 의 JS 감지 스크립트가 붙는다', {
        text: 'NOWSECURE\nby nodriver\nNOWSECURE\nby nodriver',
        html: '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>nowsecure.nl</title></head><body><h1>NOWSECURE</h1>'
            + '<script>(function(){function c(){var b=a.contentDocument||(a.contentWindow&&a.contentWindow.document);if(b){var d=b.createElement(\'script\');'
            + 'd.innerHTML="window.__CF$cv$params={r:\'a44f9239eb408e03\',t:\'MTc5MTA2ODUxMg==\'};var a=document.createElement(\'script\');'
            + 'a.src=\'/cdn-cgi/challenge-platform/scripts/jsd/main.js\';document.getElementsByTagName(\'head\')[0].appendChild(a);";'
            + 'b.getElementsByTagName(\'head\')[0].appendChild(d)}}})();</script></body></html>',
    }],
];

/** 실제 차단·확인 화면 — 경고가 붙지 않으면 미탐이다. */
const BLOCKED: Array<[string, { text?: string; html?: string }]> = [
    ['Cloudflare "Just a moment…" (본문)', {
        text: 'Just a moment...\nexample.com\nVerifying you are human. This may take a few seconds.\n'
            + 'example.com needs to review the security of your connection before proceeding.\nRay ID: 8a1b2c3d4e5f6789\nPerformance & security by Cloudflare',
    }],
    ['Cloudflare "Just a moment…" (HTML)', {
        html: '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="refresh" content="390"></head>'
            + '<body><div class="main-wrapper"><noscript>Enable JavaScript and cookies to continue</noscript></div>'
            + '<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1?ray=8a1b2c3d"></script></body></html>',
    }],
    ['Cloudflare "Checking your browser" (구형)', {
        text: 'Checking your browser before accessing example.com.\nThis process is automatic. Your browser will redirect to your requested content shortly.\n'
            + 'Please allow up to 5 seconds…\nDDoS protection by Cloudflare\nRay ID: 6f1e2d3c4b5a6978',
    }],
    ['Cloudflare 캡차 확인(구형, hCaptcha)', {
        text: 'One more step\nPlease complete the security check to access example.com\nWhy do I have to complete a CAPTCHA?\n'
            + 'Completing the CAPTCHA proves you are a human and gives you temporary access to the web property.\nCloudflare Ray ID: 5e4d3c2b1a0f9e8d',
        html: '<html><head><title>Attention Required! | Cloudflare</title></head><body><div id="cf-wrapper"><div class="cf-captcha-container"><div class="h-captcha"></div></div></div></body></html>',
    }],
    ['Cloudflare Turnstile "Verify you are human"', {
        text: 'example.com\nVerify you are human by completing the action below.\nexample.com needs to review the security of your connection before proceeding.',
    }],
    ['Google reCAPTCHA 확인(unusual traffic)', {
        text: 'Our systems have detected unusual traffic from your computer network. This page checks to see if it\'s really you sending the requests, and not a robot. '
            + 'Why did this happen?\nIP address: 203.0.113.7\nTime: 2026-10-04T01:02:03Z\nURL: https://www.google.com/search?q=test',
    }],
    ['Akamai "Access Denied … Reference #"', {
        text: 'Access Denied\nYou don\'t have permission to access "http://www.example.com/products" on this server.\n'
            + 'Reference #18.2d351ab8.1727999999.a4e16ab\nhttps://errors.edgesuite.net/18.2d351ab8.1727999999.a4e16ab',
        html: '<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY><H1>Access Denied</H1>You don\'t have permission to access "http&#58;&#47;&#47;www&#46;example&#46;com&#47;products" on this server.<P>Reference&#32;&#35;18&#46;2d351ab8</BODY></HTML>',
    }],
    ['Akamai (다른 글 뒤에 붙은 본문)', {
        text: 'example.com\nAccess Denied\nYou don\'t have permission to access "http://www.example.com/" on this server.\nReference #18.9c5a1602.1728000000.1f2e3d4c',
    }],
    ['PerimeterX "Press & Hold"', {
        text: 'Access to this page has been denied\nPress & Hold to confirm you are a human (and not a bot).\nReference ID: #a1b2c3d4-8271-11ef-9c0a-0242ac120002',
        html: '<html><head><title>Access to this page has been denied</title></head><body><div id="px-captcha"></div></body></html>',
    }],
    ['DataDome 확인 화면(HTML)', {
        html: '<html><head><title>example.com</title></head><body><script>var dd={"cid":"x","host":"geo.captcha-delivery.com"}</script>'
            + '<script src="https://ct.captcha-delivery.com/c.js"></script></body></html>',
    }],
    ['Imperva Incapsula', {
        text: 'Request unsuccessful. Incapsula incident ID: 1234000890123456789-123456789012345678',
        html: '<html><head><META NAME="ROBOTS" CONTENT="NOINDEX, NOFOLLOW"></head><body><iframe src="/_Incapsula_Resource?CWUDNSAI=9"></iframe></body></html>',
    }],
    ['한국어 차단 화면', { text: '비정상적인 접근이 감지되었습니다.\n잠시 후 다시 시도해 주세요.' }],
    ['Google 확인 화면(한국어) — 고객센터 글이 인용한 문구', { text: 'Google의 시스템이 컴퓨터 네트워크에서 비정상적인 트래픽을 감지했습니다.' }],
    ['실측: Cloudflare 확인 화면(www.cloudflare.com/learning, HTTP 403)', {
        html: '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta name="robots" content="noindex,nofollow"></head>'
            + '<body><div class="main-wrapper" role="main"><div class="main-content"><noscript><div class="h2"><span id="challenge-error-text">Enable JavaScript and cookies to continue</span></div></noscript></div></div>'
            + '<script nonce="x">(function(){window._cf_chl_opt = {cFPWv: \'b\',cITimeS: \'1791068491\',cRay: \'a44f91baf9efde66\',cTplB: \'0\'};var a = document.createElement(\'script\');'
            + 'a.src = \'/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=a44f91baf9efde66\';document.getElementsByTagName(\'head\')[0].appendChild(a);}());</script></body></html>',
    }],
    ['실측: DataDome 확인 화면(www.g2.com, HTTP 403)', {
        text: 'Please enable JS and disable any ad blocker',
        html: '<html lang="ko"><head><title>g2.com</title><style>#cmsg{animation: A 1.5s;}</style></head><body style="margin:0"><p id="cmsg">Please enable JS and disable any ad blocker</p>'
            + '<script data-cfasync="false">var dd={\'rt\':\'i\',\'cid\':\'AHrlqAAAAAMA\',\'host\':\'geo.captcha-delivery.com\'}</script><script data-cfasync="false" src="https://ct.captcha-delivery.com/i.js"></script></body></html>',
    }],
];

describe('looksBotBlocked — 정상 페이지 표본(오탐)', () => {
    it.each(NORMAL)('%s — 본문만', (_name, r) => {
        if (r.text === undefined) return;
        expect(looksBotBlocked(out({ text: r.text }))).toBe(false);
    });
    it.each(NORMAL)('%s — HTML 만', (_name, r) => {
        if (r.html === undefined) return;
        expect(looksBotBlocked(out({ html: r.html }))).toBe(false);
    });
});

describe('looksBotBlocked — 실제 차단 화면 표본(미탐)', () => {
    it.each(BLOCKED)('%s — 본문만', (_name, r) => {
        if (r.text === undefined) return;
        expect(looksBotBlocked(out({ text: r.text }))).toBe(true);
    });
    it.each(BLOCKED)('%s — HTML 만', (_name, r) => {
        if (r.html === undefined) return;
        expect(looksBotBlocked(out({ html: r.html }))).toBe(true);
    });
});
