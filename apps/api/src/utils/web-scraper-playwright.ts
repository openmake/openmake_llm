/**
 * 웹 스크래퍼 2단계 — Playwright 로 페이지를 렌더링해 HTML 을 돌려준다(SPA 폴백).
 *
 * 호출마다 새 브라우저를 띄우므로 동시 실행 상한을 두고, 대상 호스트는 검증한 주소에 고정하며,
 * 요청 가드 밖의 통신 경로(서비스 워커·WebSocket)는 닫는다(2026-11-08 점검 후속 보강).
 *
 * @module utils/web-scraper-playwright
 * @see utils/web-scraper.ts - 폴백 순서와 HTML → Markdown 변환
 */

import { isIP } from 'net';
import { resolveOutboundUrl, validateOutboundUrl } from '../security/ssrf-guard';
import { SCRAPER_CONFIG } from '../config/web-scraper';
import { createLogger } from './logger';
import { createRouteGuard } from './web-scraper-route-guard';

const logger = createLogger('WebScraper');

/** 브라우저 동시 실행 수 */
const playwrightSlots = { inFlight: 0 };

/** 상한 미만이면 자리를 하나 잡고 true, 상한이면 false. 자리는 호출자가 끝날 때 돌려준다. */
export function acquirePlaywrightSlot(state: { inFlight: number }, max: number): boolean {
    if (state.inFlight >= max) return false;
    state.inFlight += 1;
    return true;
}

/**
 * 페이지를 렌더링한 HTML. 상한이면 바로 던진다 — 호출부가 다음 폴백으로 넘어간다.
 */
export async function renderPageHtml(url: string, timeoutMs: number): Promise<string> {
    if (!acquirePlaywrightSlot(playwrightSlots, SCRAPER_CONFIG.PLAYWRIGHT_MAX_CONCURRENT)) {
        throw new Error('브라우저 스크래핑 동시 실행 상한 초과');
    }
    try {
        return await renderWithBrowser(url, timeoutMs);
    } finally {
        playwrightSlots.inFlight -= 1;
    }
}

async function renderWithBrowser(url: string, timeoutMs: number): Promise<string> {
    let chromium;
    try {
        const pw = await import('playwright-core');
        chromium = pw.chromium;
    } catch {
        throw new Error('playwright-core가 설치되지 않았습니다. SPA 스크래핑을 사용하려면 npm install playwright-core를 실행하세요.');
    }

    // 대상 호스트는 방금 검증한 주소로 고정한다 — 브라우저는 호출마다 새로 뜨므로 이 규칙은 이번 실행에만 쓰인다.
    const { url: target, address } = await resolveOutboundUrl(url);
    const pinned = isIP(address) === 6 ? `[${address}]` : address;
    const browser = await chromium.launch({
        headless: true,
        args: [`--host-resolver-rules=MAP ${target.hostname} ${pinned}`],
    });
    try {
        // 스크래핑에는 서비스 워커·WebSocket 이 필요 없다 — 요청 가드 밖의 통신 경로를 닫는다.
        const context = await browser.newContext({ serviceWorkers: 'block' });
        const page = await context.newPage();
        await page.routeWebSocket('**', (ws) => ws.close());
        // SSRF 방어: Playwright 는 자체 네트워크 스택을 써서 safeFetch 의 redirect 재검증·DNS 핀을
        // 우회한다. 문서 네비게이션(초기 goto + 서버 redirect)뿐 아니라 하위 리소스(img/css/script/fetch)까지
        // 모든 요청을 validateOutboundUrl 로 검사해 내부/메타데이터 엔드포인트 접근을 차단한다(요청마다 검증).
        const guard = createRouteGuard(validateOutboundUrl);
        await page.route('**/*', async (route) => {
            const request = route.request();
            if (!(await guard(request.url()))) {
                logger.warn(`[${url}] Playwright 네비게이션 SSRF 차단: ${request.url()}`);
                await route.abort('blockedbyclient');
                return;
            }
            await route.continue();
        });
        await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
        // 안전망: route 가 못 잡은 클라이언트측(JS/meta) redirect 대비 최종 URL 재검증.
        await validateOutboundUrl(page.url());
        return await page.content();
    } finally {
        await browser.close();
    }
}
