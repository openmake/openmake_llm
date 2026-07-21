/**
 * browser-runner — task 샌드박스 컨테이너 내부에서 playwright chromium 으로
 * 액션 시퀀스를 실행한다(Manus화 G2). 호스트가 아닌 컨테이너 내 격리 실행.
 *
 * 사용: node /opt/browser/browser-runner.mjs <actionsJsonPath(/workspace 상대 또는 절대)>
 * 입력 JSON: { actions: [...], allowlist?: ["example.com"], timeoutMs?: number, headless?: bool }
 * 출력(stdout): { ok, finalUrl, results: [...], error? }
 *
 * egress 제어: allowlist 가 있으면 context.route 로 비허용 호스트 요청을 abort
 *   (브라우저 레벨 도메인 화이트리스트 — 컨테이너 network=bridge 의 over-reach 를 좁힘).
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKSPACE = '/workspace';
const MAX_ACTIONS = 40;
const DEFAULT_TIMEOUT = 20000;

function out(obj) { process.stdout.write(JSON.stringify(obj)); }

const argPath = process.argv[2];
if (!argPath) { out({ ok: false, error: 'actions JSON 경로 인자 필요' }); process.exit(1); }

let spec;
try {
    const abs = argPath.startsWith('/') ? argPath : resolve(WORKSPACE, argPath);
    spec = JSON.parse(readFileSync(abs, 'utf8'));
} catch (e) {
    out({ ok: false, error: `actions JSON 읽기 실패: ${e.message}` });
    process.exit(1);
}

const actions = Array.isArray(spec.actions) ? spec.actions.slice(0, MAX_ACTIONS) : [];
const timeout = Number(spec.timeoutMs) > 0 ? Number(spec.timeoutMs) : DEFAULT_TIMEOUT;
const allowlist = Array.isArray(spec.allowlist) ? spec.allowlist.map(String) : null;
// 세션 지속(#2 Part A): spec.statePath 가 있으면 storageState(쿠키·localStorage)를 그 파일에서
// 복원하고 실행 후 다시 저장 → 호출 간 로그인 유지. 파일은 workspace 내(task 격리·정리와 동일 수명).
const statePath = typeof spec.statePath === 'string' && spec.statePath
    ? resolve(WORKSPACE, spec.statePath.replace(/[^A-Za-z0-9._-]/g, '_'))
    : null;

function hostAllowed(url) {
    if (!allowlist) return true;
    try {
        const h = new URL(url).hostname;
        return allowlist.some((d) => h === d || h.endsWith('.' + d));
    } catch { return false; }
}

const results = [];
let finalUrl = '';
let browser;
try {
    // egress 프록시(BROWSER_PROXY) 가 주입되면 chromium 의 모든 트래픽을 프록시 경유 — 프록시가
    // 네트워크 레벨 도메인 allowlist 를 강제(page.route 앱-레벨 위의 이중방어).
    const proxyServer = process.env.BROWSER_PROXY || spec.proxy;
    browser = await chromium.launch({
        headless: spec.headless !== false,
        ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
    });
    // 이전 세션 상태가 있으면 복원(로그인 유지). 손상 파일은 무시하고 새 세션으로.
    const restore = statePath && existsSync(statePath) ? { storageState: statePath } : {};
    const context = await browser.newContext(restore);
    context.setDefaultTimeout(timeout);
    if (allowlist) {
        await context.route('**', (route) => {
            if (hostAllowed(route.request().url())) route.continue();
            else route.abort();
        });
    }
    const page = await context.newPage();

    for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        try {
            switch (a.type) {
                case 'goto':
                    if (!hostAllowed(a.url)) throw new Error(`allowlist 차단: ${a.url}`);
                    await page.goto(a.url, { waitUntil: a.waitUntil || 'domcontentloaded', timeout });
                    results.push({ i, type: a.type, ok: true, url: page.url() }); break;
                case 'click':
                    await page.click(a.selector, { timeout });
                    results.push({ i, type: a.type, ok: true }); break;
                case 'fill':
                    await page.fill(a.selector, String(a.text ?? ''), { timeout });
                    results.push({ i, type: a.type, ok: true }); break;
                case 'press':
                    await page.keyboard.press(a.key);
                    results.push({ i, type: a.type, ok: true }); break;
                case 'wait':
                    await page.waitForTimeout(Math.min(Number(a.ms) || 0, 10000));
                    results.push({ i, type: a.type, ok: true }); break;
                case 'waitFor':
                    await page.waitForSelector(a.selector, { timeout });
                    results.push({ i, type: a.type, ok: true }); break;
                case 'screenshot': {
                    const p = (a.path || `screenshot-${i}.png`).replace(/[^A-Za-z0-9._-]/g, '_');
                    await page.screenshot({ path: resolve(WORKSPACE, p), fullPage: !!a.fullPage });
                    results.push({ i, type: a.type, ok: true, path: p }); break;
                }
                case 'extractText': {
                    const text = a.selector
                        ? await page.locator(a.selector).first().innerText({ timeout })
                        : await page.evaluate(() => document.body.innerText);
                    results.push({ i, type: a.type, ok: true, text: String(text).slice(0, 8000) }); break;
                }
                case 'extractHtml': {
                    const html = a.selector
                        ? await page.locator(a.selector).first().innerHTML({ timeout })
                        : await page.content();
                    results.push({ i, type: a.type, ok: true, html: String(html).slice(0, 8000) }); break;
                }
                default:
                    results.push({ i, type: a.type, ok: false, error: '알 수 없는 action' });
            }
        } catch (e) {
            results.push({ i, type: a?.type, ok: false, error: e.message });
            break; // 액션 실패 시 중단
        }
    }
    finalUrl = page.url();
    // 세션 상태 저장(로그인 등) — 액션 일부 실패로 중단됐어도 이전까지의 상태는 보존.
    if (statePath) { try { await context.storageState({ path: statePath }); } catch { /* 저장 실패는 무시 */ } }
    out({ ok: results.every((r) => r.ok), finalUrl, results, ...(statePath ? { sessionPersisted: true } : {}) });
} catch (e) {
    out({ ok: false, error: e.message, results });
} finally {
    if (browser) await browser.close().catch(() => {});
}
