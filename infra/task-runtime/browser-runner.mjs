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
import { readFileSync } from 'node:fs';
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
    browser = await chromium.launch({ headless: spec.headless !== false });
    const context = await browser.newContext();
    context.setDefaultTimeout(timeout);
    if (allowlist) {
        await context.route('**', (route) => {
            hostAllowed(route.request().url()) ? route.continue() : route.abort();
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
    out({ ok: results.every((r) => r.ok), finalUrl, results });
} catch (e) {
    out({ ok: false, error: e.message, results });
} finally {
    if (browser) await browser.close().catch(() => {});
}
