/**
 * 브라우저 넘겨받기 세션 스크립트 — 작업 공간에 써서 task-runtime 이미지 안의 node·playwright 로 실행한다
 * (이미지를 다시 굽지 않고 배포하려고 소스를 여기 둔다). 컨테이너 안 루프백에서만 명령을 받는다.
 *
 * 명령(POST /cmd, JSON): ping · shot · click{x,y} · type{text} · key{key} · scroll{dy} · goto{url} · back · close
 * 종료(close·유휴 상한·SIGTERM) 때 로그인 상태(storageState)를 파일에 저장한다 — 에이전트의 다음 browser 호출이 이어받는다.
 *
 * @module services/task-sandbox/browser-session-script
 */
export const BROWSER_SESSION_SCRIPT = String.raw`
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';

// 스크립트는 /workspace 에 있지만 playwright 는 이미지의 /opt/browser 에 깔려 있다
const { chromium } = createRequire('/opt/browser/')('playwright');

const env = process.env;
const STATE = '/workspace/' + (env.OMK_STATE_FILE || '.browser-state.json');
const IDLE_MS = Number(env.OMK_IDLE_MS) || 600000;
const PORT = Number(env.OMK_PORT) || 9333;
const viewport = { width: Number(env.OMK_VIEW_W) || 1280, height: Number(env.OMK_VIEW_H) || 800 };
const QUALITY = Number(env.OMK_JPEG_QUALITY) || 60;
const NAV_TIMEOUT = 20000;

const browser = await chromium.launch({
    headless: true,
    ...(env.BROWSER_PROXY ? { proxy: { server: env.BROWSER_PROXY } } : {}),
});
let context;
try {
    context = await browser.newContext({ viewport, ...(existsSync(STATE) ? { storageState: STATE } : {}) });
} catch {
    context = await browser.newContext({ viewport }); // 상태 파일이 깨졌으면 새 세션으로
}
let page = await context.newPage();
// 새 창·새 탭이 열리면 그쪽을 따라간다
context.on('page', (p) => { page = p; });
async function cur() {
    if (page.isClosed()) {
        const rest = context.pages();
        page = rest.length ? rest[rest.length - 1] : await context.newPage();
    }
    return page;
}

let closing = false;
async function shutdown() {
    if (closing) return;
    closing = true;
    try { await context.storageState({ path: STATE }); } catch { /* 저장 실패해도 내린다 */ }
    await browser.close().catch(() => {});
    process.exit(0);
}
let idle = setTimeout(shutdown, IDLE_MS);
function touch() { clearTimeout(idle); idle = setTimeout(shutdown, IDLE_MS); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const ops = {
    async ping() { return {}; },
    async shot() {
        const p = await cur();
        const buf = await p.screenshot({ type: 'jpeg', quality: QUALITY });
        return { image: buf.toString('base64'), url: p.url(), title: await p.title().catch(() => '') };
    },
    async click(c) { await (await cur()).mouse.click(Number(c.x), Number(c.y)); },
    async type(c) { await (await cur()).keyboard.type(String(c.text ?? '')); },
    async key(c) { await (await cur()).keyboard.press(String(c.key)); },
    async scroll(c) { await (await cur()).mouse.wheel(0, Number(c.dy) || 0); },
    async goto(c) { await (await cur()).goto(String(c.url), { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }); },
    async back() { await (await cur()).goBack({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }); },
    async close() { setTimeout(shutdown, 50); },
};

if (env.OMK_START_URL) {
    await page.goto(env.OMK_START_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }).catch(() => {});
}

createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
        let out;
        try {
            const c = JSON.parse(body || '{}');
            if (!Object.hasOwn(ops, c.op)) throw new Error('unknown op');
            // 화면을 보기만 하는 것은 유휴로 친다 — 조작이 있어야 상한이 다시 시작된다
            if (c.op !== 'shot' && c.op !== 'ping') touch();
            out = { ok: true, ...((await ops[c.op](c)) || {}) };
        } catch (e) {
            out = { ok: false, error: String((e && e.message) || e).slice(0, 500) };
        }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(out));
    });
}).listen(PORT, '127.0.0.1');
`;
