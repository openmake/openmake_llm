/**
 * LocalBrowser — 실제 Chrome(화면 없음)으로 액션·사이트 정책·제어권·지속 세션을 검증한다.
 * Chrome 이 없는 환경과 CI 에서는 건너뛴다. 실행 전 OMK_BRIDGE_BROWSER_HEADLESS=1 이 필요하다(아래에서 설정).
 */
process.env.OMK_BRIDGE_BROWSER_HEADLESS = '1';

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { findChrome } from '../browser/chrome';
import { LocalBrowser, BROWSER_USER_CONTROL_ERROR, screenshotName, type BrowserRunOptions } from '../browser/local-browser';
import { BridgeCore } from '../core';
import type { BridgeMsg, BridgeResult } from '../types';

const PAGES: Record<string, string> = {
    '/': '<html><body><h1 id="t">첫 페이지</h1><a id="next" href="/form">양식으로</a><a id="pop" target="_blank" href="/done?from=popup">새 창</a></body></html>',
    '/form': `<html><body><form action="/done" method="get">
        <label>이름 <input id="name" name="name" aria-label="이름"></label>
        <textarea id="memo" name="memo" aria-label="메모"></textarea>
        <div id="rich" contenteditable="true" style="min-height:20px;border:1px solid"></div>
        <button id="send" type="submit">보내기</button></form>
        <button id="ask" onclick="document.getElementById('out').textContent = confirm('정말 삭제할까요?') ? '삭제함' : '취소함'">삭제</button>
        <p id="out"></p></body></html>`,
    '/late': '<html><body><script>setTimeout(() => { const b = document.createElement("button"); b.id = "late"; b.textContent = "늦게 뜬 버튼"; b.onclick = () => document.title = "눌림"; document.body.appendChild(b); }, 400);</script></body></html>',
};

// CI 러너의 Chrome 은 샌드박스 제약(비특권 사용자 네임스페이스)으로 뜨지 않을 수 있어 건너뛴다 — 개발 장비에서 돌린다.
// 이 파일은 따로, 순서대로 실행한다(package.json test) — Chrome 기동 부하가 시간에 민감한 다른 테스트를 흔들지 않게.
const describeIfChrome = findChrome() && process.env.CI !== 'true' ? describe : describe.skip;

describeIfChrome('LocalBrowser (실제 Chrome)', () => {
    let server: http.Server;
    let origin: string;
    let other: string;
    let profile: string;
    let outDir: string;
    let browser: LocalBrowser;
    const hits: string[] = [];

    const opts = (taskId = 't1'): BrowserRunOptions => ({
        taskId, downloadDir: outDir,
        saveFile: async (name, data) => { await fs.promises.writeFile(path.join(outDir, name), data); },
    });
    const allowAll = () => ({ allow: ['127.0.0.1', 'localhost'], deny: [] });

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            hits.push(req.url ?? '');
            const u = new URL(req.url ?? '/', 'http://x');
            if (u.pathname === '/redirect') { res.writeHead(302, { Location: `${other}/form` }); res.end(); return; }
            const body = u.pathname === '/done' ? `<html><body><p id="got">받음: ${u.search}</p></body></html>` : PAGES[u.pathname];
            res.writeHead(body ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(body ?? 'not found');
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        const port = (server.address() as AddressInfo).port;
        origin = `http://127.0.0.1:${port}`;
        other = `http://localhost:${port}`; // 같은 서버, 다른 호스트 이름 — 사이트 정책에서는 다른 사이트다
        profile = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-browser-profile-'));
        outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-browser-out-'));
        browser = LocalBrowser.forProfile(profile);
    }, 30000);

    afterAll(async () => {
        await browser.dispose();
        await new Promise<void>((r) => server.close(() => r()));
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        fs.rmSync(outDir, { recursive: true, force: true });
    }, 30000);

    it('goto → extractText·extractHtml·snapshot', async () => {
        const r = await browser.run({ actions: [
            { type: 'goto', url: `${origin}/` }, { type: 'extractText', selector: '#t' }, { type: 'extractHtml', selector: '#t' }, { type: 'snapshot' },
        ], sitePolicy: allowAll() }, opts());
        expect(r.ok).toBe(true);
        expect(r.finalUrl).toBe(`${origin}/`);
        expect(r.results[1].text).toBe('첫 페이지');
        expect(r.results[2].html).toBe('첫 페이지');
        expect(r.results[3].elements).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'link', name: '양식으로' })]));
    }, 60000);

    it('호출이 끝나도 탭이 남는다 — 다음 호출이 같은 페이지에서 이어진다', async () => {
        const r = await browser.run({ actions: [{ type: 'click', selector: '#next' }, { type: 'extractText', selector: 'button#send' }], sitePolicy: allowAll() }, opts());
        expect(r.ok).toBe(true);
        expect(r.finalUrl).toBe(`${origin}/form`);
        expect(r.results[1].text).toBe('보내기');
    }, 60000);

    it('fill(input·textarea·contenteditable) → 제출하면 입력이 그대로 전송된다', async () => {
        const r = await browser.run({ actions: [
            { type: 'fill', selector: '#name', text: '홍길동' }, { type: 'fill', selector: '#memo', text: '첫째 줄' },
            { type: 'fill', selector: '#rich', text: '서식 입력' }, { type: 'extractText', selector: '#rich' },
            { type: 'fill', selector: '#name', text: '바꾼 이름' }, { type: 'click', selector: '#send' }, { type: 'extractText', selector: '#got' },
        ], sitePolicy: allowAll() }, opts());
        expect(r.results.map((x) => x.ok)).toEqual([true, true, true, true, true, true, true]);
        expect(r.results[3].text).toBe('서식 입력');
        const got = decodeURIComponent(String(r.results[6].text).replace(/\+/g, ' ')); // 폼 전송은 공백을 + 로 싣는다
        expect(got).toContain('name=바꾼 이름');   // 두 번째 fill 이 기존 값을 대체했다
        expect(got).toContain('memo=첫째 줄');
    }, 60000);

    it('smartClick·smartFill — role·name 으로 요소를 찾는다, press Enter 로 제출', async () => {
        const r = await browser.run({ actions: [
            { type: 'goto', url: `${origin}/form` }, { type: 'smartFill', role: 'textbox', name: '이름', text: '김철수' },
            { type: 'press', key: 'Enter' }, { type: 'extractText', selector: '#got' },
        ], sitePolicy: allowAll() }, opts());
        expect(r.ok).toBe(true);
        expect(decodeURIComponent(String(r.results[3].text))).toContain('name=김철수');
        const back = await browser.run({ actions: [{ type: 'goto', url: `${origin}/` }, { type: 'smartClick', role: 'link', name: '양식' }], sitePolicy: allowAll() }, opts());
        expect(back.finalUrl).toBe(`${origin}/form`);
    }, 60000);

    it('확인창 — 기본은 취소하고 결과에 싣는다, dialog{accept:true} 뒤에는 수락한다', async () => {
        const dismiss = await browser.run({ actions: [{ type: 'goto', url: `${origin}/form` }, { type: 'click', selector: '#ask' }, { type: 'extractText', selector: '#out' }], sitePolicy: allowAll() }, opts());
        expect(dismiss.results[1].dialogs).toEqual([{ type: 'confirm', message: '정말 삭제할까요?', handled: 'dismissed' }]);
        expect(dismiss.results[2].text).toBe('취소함');
        const accept = await browser.run({ actions: [{ type: 'dialog', accept: true }, { type: 'click', selector: '#ask' }, { type: 'extractText', selector: '#out' }], sitePolicy: allowAll() }, opts());
        expect(accept.results[2].text).toBe('삭제함');
    }, 60000);

    it('나중에 나타나는 요소를 기다린다(waitFor·click)', async () => {
        const r = await browser.run({ actions: [{ type: 'goto', url: `${origin}/late` }, { type: 'waitFor', selector: '#late' }, { type: 'click', selector: '#late' }, { type: 'wait', ms: 50 }], sitePolicy: allowAll() }, opts());
        expect(r.ok).toBe(true);
    }, 60000);

    it('screenshot 은 호출부가 준 저장 함수로만 쓴다', async () => {
        const r = await browser.run({ actions: [{ type: 'goto', url: `${origin}/` }, { type: 'screenshot', path: '/workspace/shots/a b.png' }], sitePolicy: allowAll() }, opts());
        expect(r.results[1].path).toBe('shots_a_b.png');
        expect(fs.statSync(path.join(outDir, 'shots_a_b.png')).size).toBeGreaterThan(100);
    }, 60000);

    it('빈 페이지에서 페이지 액션을 실행하면 이유를 담아 실패한다', async () => {
        const r = await browser.run({ actions: [{ type: 'extractText' }], sitePolicy: allowAll() }, opts('fresh-task'));
        expect(r.ok).toBe(false);
        expect(String(r.results[0].error)).toContain('about:blank');
    }, 60000);

    describe('사이트 정책', () => {
        it('허용 목록 밖 사이트의 읽기는 되고 입력은 실행하지 않는다', async () => {
            hits.length = 0;
            const r = await browser.run({ actions: [
                { type: 'goto', url: `${origin}/form` }, { type: 'extractText', selector: '#send' },
                { type: 'fill', selector: '#name', text: '새면 안 되는 자료' }, { type: 'click', selector: '#send' },
            ], sitePolicy: { allow: [], deny: [] } }, opts());
            expect(r.results.map((x) => x.ok)).toEqual([true, true, false]);
            expect(String(r.results[2].error)).toContain('사용자 승인이 필요');
            expect(hits.some((h) => h.startsWith('/done'))).toBe(false);
            expect(r.finalUrl).toBe(`${origin}/form`); // 막혀도 현재 주소는 돌려준다 — 서버가 다음 판정에 쓴다
        }, 60000);

        it('승인된 호스트의 입력은 실행한다', async () => {
            const r = await browser.run({ actions: [{ type: 'goto', url: `${origin}/form` }, { type: 'fill', selector: '#name', text: 'ok' }],
                sitePolicy: { allow: [], deny: [] }, approvedHosts: ['127.0.0.1'] }, opts());
            expect(r.ok).toBe(true);
        }, 60000);

        it('리다이렉트로 다른 사이트에 도착하면 그 사이트의 입력은 막는다 — 서버가 본 주소가 아니라 실제 주소로 판정', async () => {
            const r = await browser.run({ actions: [{ type: 'goto', url: `${origin}/redirect` }, { type: 'fill', selector: '#name', text: 'x' }],
                sitePolicy: { allow: ['127.0.0.1'], deny: [] } }, opts());
            expect(r.results[0]).toMatchObject({ ok: true, url: `${other}/form` });
            expect(r.results[1].ok).toBe(false);
            expect(String(r.results[1].error)).toContain('localhost');
        }, 60000);

        it('페이지가 연 새 창으로 옮겨 가서 그 주소로 판정한다', async () => {
            const r = await browser.run({ actions: [{ type: 'goto', url: `${origin}/` }, { type: 'click', selector: '#pop' }, { type: 'extractText', selector: '#got' }],
                sitePolicy: allowAll() }, opts());
            expect(r.ok).toBe(true);
            expect(r.finalUrl).toBe(`${origin}/done?from=popup`);
        }, 60000);

        it('목록 밖 사이트로 질의 문자열을 실은 이동은 승인이 필요하다', async () => {
            const r = await browser.run({ actions: [{ type: 'goto', url: `${other}/done?q=고객명` }], sitePolicy: { allow: ['127.0.0.1'], deny: [] } }, opts());
            expect(r.ok).toBe(false);
            expect(String(r.results[0].error)).toContain('사용자 승인이 필요');
        }, 60000);

        it('http(s) 가 아닌 주소로는 이동하지 않는다', async () => {
            const r = await browser.run({ actions: [{ type: 'goto', url: 'file:///etc/hosts' }, { type: 'extractText' }], sitePolicy: allowAll(), approvedHosts: [''] }, opts());
            expect(r.ok).toBe(false);
            expect(String(r.results[0].error)).toContain('이동할 수 없는 주소');
            expect(r.results).toHaveLength(1);
        }, 60000);
    });

    describe('제어권·중지·탭', () => {
        it('사용자가 넘겨받은 동안에는 실행하지 않고, 돌려주면 다시 실행한다', async () => {
            browser.setUserControl(true);
            const blocked = await browser.run({ actions: [{ type: 'goto', url: `${origin}/` }], sitePolicy: allowAll() }, opts());
            expect(blocked).toMatchObject({ ok: false, error: BROWSER_USER_CONTROL_ERROR, results: [] });
            browser.setUserControl(false);
            expect((await browser.run({ actions: [{ type: 'goto', url: `${origin}/` }], sitePolicy: allowAll() }, opts())).ok).toBe(true);
        }, 60000);

        it('중지 요청이 오면 남은 액션을 실행하지 않는다', async () => {
            const p = browser.run({ actions: [{ type: 'goto', url: `${origin}/` }, { type: 'wait', ms: 600 }, { type: 'goto', url: `${origin}/form` }], sitePolicy: allowAll() }, opts());
            setTimeout(() => browser.requestStop(), 300);
            const r = await p;
            expect(r.ok).toBe(false);
            expect(r.finalUrl).toBe(`${origin}/`);
            expect(String(r.results[r.results.length - 1].error)).toContain('중지');
        }, 60000);

        it('작업마다 탭이 따로다 — 한 작업의 페이지가 다른 작업에 보이지 않는다', async () => {
            await browser.run({ actions: [{ type: 'goto', url: `${origin}/form` }], sitePolicy: allowAll() }, opts('task-a'));
            const b = await browser.run({ actions: [{ type: 'goto', url: `${origin}/` }], sitePolicy: allowAll() }, opts('task-b'));
            expect(b.finalUrl).toBe(`${origin}/`);
            const a = await browser.run({ actions: [{ type: 'extractText', selector: '#send' }], sitePolicy: allowAll() }, opts('task-a'));
            expect(a.finalUrl).toBe(`${origin}/form`);
            await browser.closeTask('task-a');
            const again = await browser.run({ actions: [{ type: 'extractText' }], sitePolicy: allowAll() }, opts('task-a'));
            expect(String(again.results[0].error)).toContain('about:blank'); // 닫은 뒤에는 새 탭
        }, 60000);
    });
});

describeIfChrome('BridgeCore — browser 요청 (실제 Chrome)', () => {
    let server: http.Server;
    let origin: string;
    let folder: string;
    let profile: string;
    let core: BridgeCore;
    const run = (m: BridgeMsg): Promise<BridgeResult> => new Promise((resolve, reject) => { core.handleExec(m, resolve).catch(reject); });

    beforeAll(async () => {
        server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGES['/']); });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        folder = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-core-browser-'));
        profile = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-core-profile-'));
        core = new BridgeCore({ folder, confirm: async () => 'yes', sandboxProfileDir: os.tmpdir(), browserProfileDir: profile });
    }, 30000);
    afterAll(async () => {
        await LocalBrowser.forProfile(profile).dispose();
        await new Promise<void>((r) => server.close(() => r()));
        fs.rmSync(folder, { recursive: true, force: true });
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }, 30000);

    it('전용 프로필이 있으면 능력 목록에 browser 를 넣는다', () => {
        expect(core.capabilities()).toContain('browser');
    });

    it('러너와 같은 JSON 을 stdout 에 싣고, 스크린샷은 연결 폴더 안에 쓴다', async () => {
        const r = await run({ kind: 'browser', taskId: 'core-task-1', sitePolicy: { allow: ['127.0.0.1'] }, actions: [
            { type: 'goto', url: `${origin}/` }, { type: 'extractText', selector: '#t' }, { type: 'screenshot', path: '../../escape.png' },
        ] });
        expect(r).toMatchObject({ ok: true, exitCode: 0 });
        const out = JSON.parse(r.stdout ?? '{}') as { ok: boolean; finalUrl: string; results: Array<{ text?: string; path?: string }> };
        expect(out.ok).toBe(true);
        expect(out.results[1].text).toBe('첫 페이지');
        expect(out.results[2].path).toBe('.._.._escape.png');
        expect(fs.existsSync(path.join(fs.realpathSync(folder), '.._.._escape.png'))).toBe(true); // 폴더 밖으로 나가지 않는다
    }, 60000);

    it('사이트 정책이 없으면(빈 정책) 쓰기를 실행하지 않고 실패 종료 코드로 돌려준다', async () => {
        const r = await run({ kind: 'browser', taskId: 'core-task-1', actions: [{ type: 'click', selector: '#next' }] });
        expect(r).toMatchObject({ ok: true, exitCode: 1 });
        expect(r.stdout).toContain('사용자 승인이 필요');
    }, 60000);

    it('사용자가 넘겨받으면 실행하지 않는다', async () => {
        core.setBrowserUserControl(true);
        expect(core.browserUserControl).toBe(true);
        const r = await run({ kind: 'browser', taskId: 'core-task-1', actions: [{ type: 'extractText' }] });
        expect(r.stdout).toContain('직접 조작하는 중');
        core.setBrowserUserControl(false);
    }, 60000);

    it('task_end 가 오면 그 작업의 탭을 닫는다', async () => {
        await run({ kind: 'task_end', taskId: 'core-task-1' });
        await new Promise((r) => setTimeout(r, 300));
        const r = await run({ kind: 'browser', taskId: 'core-task-1', actions: [{ type: 'extractText' }] });
        expect(r.stdout).toContain('about:blank');
    }, 60000);
});

describe('screenshotName', () => {
    it('컨테이너 표기와 위험한 문자를 정리한다', () => {
        expect(screenshotName('/workspace/a.png', 0)).toBe('a.png');
        expect(screenshotName('../../etc/x.png', 0)).toBe('.._.._etc_x.png');
        expect(screenshotName(undefined, 3)).toBe('screenshot-3.png');
    });
});
