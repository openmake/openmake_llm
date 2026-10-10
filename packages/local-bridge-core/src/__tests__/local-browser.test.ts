/**
 * LocalBrowser — 실제 Chrome(화면 없음)으로 액션·사이트 정책·제어권·지속 세션을 검증한다.
 * Chrome 이 없는 환경과 CI 에서는 건너뛴다. 실행 전 OMK_BRIDGE_BROWSER_HEADLESS=1 이 필요하다(아래에서 설정).
 */
process.env.OMK_BRIDGE_BROWSER_HEADLESS = '1';
// 로딩 중 페이지의 추출 대기 상한 — 테스트에서는 짧게(기본은 액션 대기 상한과 같다)
process.env.OMK_BRIDGE_BROWSER_EXTRACT_READY_MS = '1500';

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
        <input id="pw" type="password" name="pw" aria-label="비밀번호">
        <div id="rich" contenteditable="true" style="min-height:20px;border:1px solid"></div>
        <button id="send" type="submit">보내기</button></form>
        <button id="ask" onclick="document.getElementById('out').textContent = confirm('정말 삭제할까요?') ? '삭제함' : '취소함'">삭제</button>
        <p id="out"></p></body></html>`,
    '/upload': `<html><body><input id="one" type="file"><input id="many" type="file" multiple><p id="up"></p><div id="notfile"></div>
        <script>for (const id of ['one', 'many']) document.getElementById(id).addEventListener('change', async (e) => {
            const parts = []; for (const f of e.target.files) parts.push(f.name + '=' + (await f.text()));
            document.getElementById('up').textContent = id + ':' + parts.join(','); });</script></body></html>`,
    '/hop': `<html><body><script>setTimeout(() => { location.href = location.href.replace('127.0.0.1', 'localhost').replace('/hop', '/upload'); }, 300);</script></body></html>`,
    // 열리자마자 /slow 로 넘어간다 — /slow 는 응답을 끝내지 않아 문서가 계속 'loading' 이다
    '/slow-hop': '<html><body><script>setTimeout(() => { location.href = "/slow"; }, 50);</script></body></html>',
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
    const slowResponses: http.ServerResponse[] = [];

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
            if (u.pathname === '/slow') { // 앞부분만 보내고 응답을 끝내지 않는다
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.write(`<html><head><title>느린 페이지</title></head><body><input id="early" value="먼저 온 부분"><!--${' '.repeat(2048)}-->`);
                slowResponses.push(res);
                return;
            }
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
        for (const res of slowResponses) res.end('</body></html>');
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

    describe('selector 없는 extractText·extractHtml — 문서가 읽히는 중이면 loading 을 싣는다', () => {
        it('다 읽힌 페이지는 종전과 같다 — loading 이 없다', async () => {
            const r = await browser.run({ actions: [{ type: 'goto', url: `${origin}/` }, { type: 'extractText' }, { type: 'extractHtml' }], sitePolicy: allowAll() }, opts('ready-task'));
            expect(r.ok).toBe(true);
            expect(r.results[1].text).toContain('첫 페이지');
            expect(r.results[1]).not.toHaveProperty('loading');
            expect(r.results[2].html).toContain('<h1 id="t">첫 페이지</h1>');
            expect(r.results[2]).not.toHaveProperty('loading');
            await browser.closeTask('ready-task');
        }, 60000);

        it('기다려도 계속 loading 이면 던지지 않고 loading: true 와 그때까지의 결과를 돌려준다', async () => {
            const r = await browser.run({ actions: [
                { type: 'goto', url: `${origin}/slow-hop` }, { type: 'wait', ms: 1000 }, { type: 'extractText' }, { type: 'extractHtml' },
            ], sitePolicy: allowAll() }, opts('slow-task'));
            expect(r.ok).toBe(true);
            expect(r.finalUrl).toBe(`${origin}/slow`);
            expect(r.results[2]).toEqual(expect.objectContaining({ ok: true, loading: true }));
            expect(r.results[2].text).toBe(''); // 보이는 글자가 아직 없다(입력 칸 값은 innerText 에 들지 않는다)
            expect(r.results[3]).toEqual(expect.objectContaining({ ok: true, loading: true }));
            expect(r.results[3].html).toContain('id="early"');
        }, 60000);

        it('selector 가 있으면 종전처럼 요소만 기다린다 — 로딩 중이어도 loading 이 없다', async () => {
            const r = await browser.run({ actions: [{ type: 'extractText', selector: '#early' }], sitePolicy: allowAll() }, opts('slow-task'));
            expect(r.ok).toBe(true);
            expect(r.results[0].text).toBe('먼저 온 부분');
            expect(r.results[0]).not.toHaveProperty('loading');
            await browser.closeTask('slow-task');
        }, 60000);
    });

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

    it('입력 결과에 들어간 값을 돌려주고, 입력 칸을 읽으면 그 값이 나온다 — 모델이 확인하려고 같은 입력을 되풀이하지 않게', async () => {
        const r = await browser.run({ actions: [
            { type: 'goto', url: `${origin}/form` },
            { type: 'fill', selector: '#name', text: '홍길동' }, { type: 'smartFill', role: 'textbox', name: '메모', text: '둘째 줄' },
            { type: 'extractText', selector: '#name' }, { type: 'extractText', selector: '#memo' },
            { type: 'fill', selector: '#pw', text: 'secret-123' }, { type: 'extractText', selector: '#pw' },
        ], sitePolicy: allowAll() }, opts());
        expect(r.results.map((x) => x.ok)).toEqual([true, true, true, true, true, true, true]);
        expect(r.results[1].value).toBe('홍길동');
        expect(r.results[2].value).toBe('둘째 줄');
        expect(r.results[3].text).toBe('홍길동');
        expect(r.results[4].text).toBe('둘째 줄');
        // 비밀번호 칸의 값은 결과에 싣지 않는다 — 모델 대화와 작업 기록에 남는다
        expect(r.results[5].value).toBeUndefined();
        expect(r.results[6].text).toBe('');
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
            expect(r.policyBlock).toEqual({ kind: 'site_off_list', host: '127.0.0.1', action: 'fill' }); // 서버 감사 기록용 — 입력 내용 없음
        }, 60000);

        it('승인된 호스트의 입력은 실행한다', async () => {
            const r = await browser.run({ actions: [{ type: 'goto', url: `${origin}/form` }, { type: 'fill', selector: '#name', text: 'ok' }],
                sitePolicy: { allow: [], deny: [] }, approvedHosts: ['127.0.0.1'] }, opts());
            expect(r.ok).toBe(true);
            expect(r.policyBlock).toBeUndefined();
        }, 60000);

        it('리다이렉트로 다른 사이트에 도착하면 그 사이트의 입력은 막는다 — 서버가 본 주소가 아니라 실제 주소로 판정', async () => {
            const r = await browser.run({ actions: [{ type: 'goto', url: `${origin}/redirect` }, { type: 'fill', selector: '#name', text: 'x' }],
                sitePolicy: { allow: ['127.0.0.1'], deny: [] } }, opts());
            expect(r.results[0]).toMatchObject({ ok: true, url: `${other}/form` });
            expect(r.results[1].ok).toBe(false);
            expect(String(r.results[1].error)).toContain('localhost');
            expect(r.policyBlock).toEqual({ kind: 'site_off_list', host: 'localhost', action: 'fill' });
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
            expect(r.policyBlock).toEqual({ kind: 'blocked_url', host: null, action: 'goto' });
        }, 60000);
    });

    describe('업로드(uploadFile)', () => {
        const approved = (files: string[]) => [{ host: '127.0.0.1', files }];
        const uploadOpts = (resolved: string[]): BrowserRunOptions => ({ ...opts('t-up'), resolveUploadFiles: async () => resolved });

        it('승인된 호스트·파일 목록이면 파일 선택 칸에 넣고, 페이지가 change 로 받는다', async () => {
            const file = path.join(outDir, 'hello.txt');
            fs.writeFileSync(file, '안녕');
            const r = await browser.run({ actions: [
                { type: 'goto', url: `${origin}/upload` }, { type: 'uploadFile', selector: '#one', files: ['hello.txt'] }, { type: 'extractText', selector: '#up' },
            ], sitePolicy: allowAll(), approvedUploads: approved(['hello.txt']) }, uploadOpts([file]));
            expect(r.ok).toBe(true);
            expect(r.results[1]).toMatchObject({ ok: true, type: 'uploadFile', files: ['hello.txt'] });
            expect(r.results[2].text).toBe('one:hello.txt=안녕');
        }, 60000);

        it('여러 파일은 multiple 칸에만 넣는다', async () => {
            const a = path.join(outDir, 'a.txt'); const b = path.join(outDir, 'b.txt');
            fs.writeFileSync(a, 'A'); fs.writeFileSync(b, 'B');
            const ok = await browser.run({ actions: [{ type: 'uploadFile', selector: '#many', files: ['a.txt', 'b.txt'] }, { type: 'extractText', selector: '#up' }],
                sitePolicy: allowAll(), approvedUploads: approved(['a.txt', 'b.txt']) }, uploadOpts([a, b]));
            expect(ok.results[1].text).toBe('many:a.txt=A,b.txt=B');
            const single = await browser.run({ actions: [{ type: 'uploadFile', selector: '#one', files: ['a.txt', 'b.txt'] }],
                sitePolicy: allowAll(), approvedUploads: approved(['a.txt', 'b.txt']) }, uploadOpts([a, b]));
            expect(single.results[0]).toMatchObject({ ok: false });
            expect(String(single.results[0].error)).toMatch(/여러 파일/);
        }, 60000);

        it('파일 선택 칸이 아닌 요소는 거절한다', async () => {
            const a = path.join(outDir, 'a.txt');
            const r = await browser.run({ actions: [{ type: 'uploadFile', selector: '#notfile', files: ['a.txt'] }],
                sitePolicy: allowAll(), approvedUploads: approved(['a.txt']) }, uploadOpts([a]));
            expect(r.results[0]).toMatchObject({ ok: false });
            expect(String(r.results[0].error)).toMatch(/파일 선택 칸/);
        }, 60000);

        it('파일 칸을 기다리는 동안 다른 사이트로 넘어가면 넣지 않는다', async () => {
            const a = path.join(outDir, 'a.txt');
            fs.writeFileSync(a, 'A');
            const r = await browser.run({ actions: [{ type: 'goto', url: `${origin}/hop` }, { type: 'uploadFile', selector: '#one', files: ['a.txt'] }],
                sitePolicy: allowAll(), approvedUploads: approved(['a.txt']) }, { ...uploadOpts([a]), taskId: 't-hop' }); // 다른 탭 — 뒤 테스트의 페이지를 바꾸지 않게
            expect(r.results[1]).toMatchObject({ ok: false });
            expect(String(r.results[1].error)).toMatch(/다른 사이트로 이동/);
        }, 60000);

        it('허용 목록 사이트여도 승인이 없거나 파일 목록이 다르면 실행하지 않는다(upload_unapproved)', async () => {
            for (const approvedUploads of [undefined, approved(['other.txt'])]) {
                const resolve = jest.fn(async () => ['/never']);
                const r = await browser.run({ actions: [{ type: 'uploadFile', selector: '#one', files: ['a.txt'] }], sitePolicy: allowAll(), approvedUploads },
                    { ...opts('t-up'), resolveUploadFiles: resolve });
                expect(r.ok).toBe(false);
                expect(r.policyBlock).toEqual({ kind: 'upload_unapproved', host: '127.0.0.1', action: 'uploadFile' });
                expect(resolve).not.toHaveBeenCalled();
            }
        }, 60000);

        it('파일 검사에서 거절되면 실행하지 않고 upload_rejected 를 남긴다', async () => {
            const r = await browser.run({ actions: [{ type: 'uploadFile', selector: '#one', files: ['.env'] }], sitePolicy: allowAll(), approvedUploads: approved(['.env']) },
                { ...opts('t-up'), resolveUploadFiles: async () => { throw new Error('숨김 파일은 올릴 수 없습니다: .env'); } });
            expect(r.ok).toBe(false);
            expect(String(r.results[0].error)).toMatch(/숨김/);
            expect(r.policyBlock).toEqual({ kind: 'upload_rejected', host: '127.0.0.1', action: 'uploadFile' });
        }, 60000);
    });

    describe('제어권·중지·탭', () => {
        it('사용자가 넘겨받은 동안에는 실행하지 않고, 돌려주면 다시 실행한다', async () => {
            browser.setUserControl(true);
            const blocked = await browser.run({ actions: [{ type: 'goto', url: `${origin}/` }], sitePolicy: allowAll() }, opts());
            expect(blocked).toMatchObject({ ok: false, error: BROWSER_USER_CONTROL_ERROR, results: [], userControl: true,
                policyBlock: { kind: 'user_control', host: null, action: 'goto' } });
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
        server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGES[new URL(req.url ?? '/', 'http://x').pathname] ?? PAGES['/']); });
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
        expect(r.policyBlock).toEqual({ kind: 'site_off_list', host: '127.0.0.1', action: 'click' }); // 결과 맨 위 — 서버 감사 기록용
    }, 60000);

    it('전용 프로필이 있으면 업로드 능력(browser_upload)도 알린다', () => {
        expect(core.capabilities()).toContain('browser_upload');
    });

    it('업로드는 연결 폴더 안의 파일만 넣고, 숨김 파일은 거절한다', async () => {
        fs.writeFileSync(path.join(folder, 'report.txt'), '보고서');
        fs.writeFileSync(path.join(folder, '.env'), 'SECRET=1');
        const set = await run({ kind: 'browser', taskId: 'core-up', sitePolicy: { allow: ['127.0.0.1'] }, approvedUploads: [{ host: '127.0.0.1', files: ['report.txt'] }],
            actions: [{ type: 'goto', url: `${origin}/upload` }, { type: 'uploadFile', selector: '#one', files: ['report.txt'] }, { type: 'extractText', selector: '#up' }] });
        expect(set).toMatchObject({ ok: true, exitCode: 0 });
        expect((JSON.parse(set.stdout ?? '{}') as { results: Array<{ text?: string }> }).results[2].text).toBe('one:report.txt=보고서');
        const hidden = await run({ kind: 'browser', taskId: 'core-up', sitePolicy: { allow: ['127.0.0.1'] }, approvedUploads: [{ host: '127.0.0.1', files: ['.env'] }],
            actions: [{ type: 'uploadFile', selector: '#pick', files: ['.env'] }] });
        expect(hidden).toMatchObject({ exitCode: 1, policyBlock: { kind: 'upload_rejected', host: '127.0.0.1', action: 'uploadFile' } });
        expect(hidden.stdout).not.toContain('SECRET');
    }, 60000);

    it('사용자가 넘겨받으면 실행하지 않는다', async () => {
        core.setBrowserUserControl(true);
        expect(core.browserUserControl).toBe(true);
        const r = await run({ kind: 'browser', taskId: 'core-task-1', actions: [{ type: 'extractText' }] });
        expect(r.stdout).toContain('직접 조작하는 중');
        expect(r).toMatchObject({ userControl: true, policyBlock: { kind: 'user_control', host: null, action: 'extractText' } });
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
