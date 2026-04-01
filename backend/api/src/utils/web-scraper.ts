/**
 * ============================================================
 * Web Scraper - 무료 웹 스크래핑 엔진
 * ============================================================
 *
 * Firecrawl을 대체하는 무료 3단계 fallback 스크래핑 엔진:
 * 1. safeFetch + @mozilla/readability + turndown (정적 사이트)
 * 2. Playwright 렌더링 + Readability (SPA fallback)
 *
 * @module utils/web-scraper
 * @see security/ssrf-guard.ts - SSRF 방어 (safeFetch)
 */

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { safeFetch, validateOutboundUrl } from '../security/ssrf-guard';
import { createLogger } from './logger';
import { LLM_TIMEOUTS } from '../config/timeouts';

const logger = createLogger('WebScraper');

// ============================================
// 서킷 브레이커 — 연속 실패 차단
// ============================================

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_MS = 5 * 60 * 1000;

const circuitState = {
    isOpen: false,
    consecutiveFailures: 0,
    openedAt: 0,
};

function checkCircuitBreaker(): void {
    if (!circuitState.isOpen) return;

    if (Date.now() - circuitState.openedAt > CIRCUIT_BREAKER_RESET_MS) {
        logger.info(`서킷 브레이커 리셋 (${CIRCUIT_BREAKER_RESET_MS / 1000}초 경과)`);
        circuitState.isOpen = false;
        circuitState.consecutiveFailures = 0;
        return;
    }

    const remainingSec = Math.ceil(
        (CIRCUIT_BREAKER_RESET_MS - (Date.now() - circuitState.openedAt)) / 1000
    );
    throw new Error(
        `웹 스크래퍼 서킷 브레이커 OPEN: 연속 ${circuitState.consecutiveFailures}회 실패. ` +
        `${remainingSec}초 후 자동 리셋`
    );
}

function recordFailure(): void {
    circuitState.consecutiveFailures++;
    if (circuitState.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        circuitState.isOpen = true;
        circuitState.openedAt = Date.now();
        logger.warn(
            `서킷 브레이커 OPEN: 연속 ${circuitState.consecutiveFailures}회 실패 — ` +
            `${CIRCUIT_BREAKER_RESET_MS / 1000}초간 요청 차단`
        );
    }
}

function recordSuccess(): void {
    if (circuitState.consecutiveFailures > 0 || circuitState.isOpen) {
        if (circuitState.isOpen) {
            logger.info('서킷 브레이커 CLOSED (성공 복구)');
        }
        circuitState.consecutiveFailures = 0;
        circuitState.isOpen = false;
    }
}

// ============================================
// Turndown 설정 (HTML → Markdown 변환)
// ============================================

function createTurndown(): TurndownService {
    const td = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
    });
    td.use(gfm);
    return td;
}

const turndown = createTurndown();

// ============================================
// Types
// ============================================

export interface ScrapeResult {
    markdown: string;
    title: string;
    links: string[];
}

export interface ScrapeOptions {
    timeoutMs?: number;
    onlyMainContent?: boolean;
    signal?: AbortSignal;
}

export interface MapOptions {
    limit?: number;
    search?: string;
}

export interface CrawlOptions {
    maxDepth?: number;
    limit?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    excludePaths?: string[];
}

// ============================================
// Core: scrapePage
// ============================================

/**
 * URL에서 웹 콘텐츠를 마크다운으로 추출
 *
 * 2단계 fallback:
 * 1. safeFetch + Readability + Turndown (정적 사이트)
 * 2. Playwright 렌더링 + Readability (SPA fallback)
 *
 * @param url - 스크래핑할 URL
 * @param options - 스크래핑 옵션
 * @returns 마크다운 콘텐츠, 제목, 링크 목록
 */
export async function scrapePage(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
    checkCircuitBreaker();
    await validateOutboundUrl(url);

    const timeoutMs = options.timeoutMs ?? LLM_TIMEOUTS.WEB_SCRAPE_TIMEOUT_MS;
    const onlyMainContent = options.onlyMainContent !== false;

    // 1단계: safeFetch + Readability
    try {
        const result = await scrapeWithFetch(url, timeoutMs, onlyMainContent, options.signal);
        if (result.markdown.trim().length > 0) {
            recordSuccess();
            return result;
        }
        logger.info(`[${url}] safeFetch 결과 비어있음 → Playwright fallback`);
    } catch (error) {
        logger.warn(`[${url}] safeFetch 실패: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 2단계: Playwright fallback (SPA 사이트)
    try {
        const result = await scrapeWithPlaywright(url, timeoutMs, onlyMainContent);
        recordSuccess();
        return result;
    } catch (error) {
        recordFailure();
        throw new Error(
            `스크래핑 실패 (${url}): ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

// ============================================
// 1단계: safeFetch + Readability
// ============================================

async function scrapeWithFetch(
    url: string,
    timeoutMs: number,
    onlyMainContent: boolean,
    signal?: AbortSignal
): Promise<ScrapeResult> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    // 외부 signal과 내부 타임아웃 결합
    if (signal) {
        if (signal.aborted) throw new Error('ABORTED');
        signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
        const response = await safeFetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; OpenMakeBot/1.0)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
            },
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        return parseHtmlToMarkdown(html, url, onlyMainContent);
    } finally {
        clearTimeout(timeoutHandle);
    }
}

// ============================================
// 2단계: Playwright fallback
// ============================================

async function scrapeWithPlaywright(
    url: string,
    timeoutMs: number,
    onlyMainContent: boolean
): Promise<ScrapeResult> {
    let chromium;
    try {
        const pw = await import('playwright-core');
        chromium = pw.chromium;
    } catch {
        throw new Error('playwright-core가 설치되지 않았습니다. SPA 스크래핑을 사용하려면 npm install playwright-core를 실행하세요.');
    }

    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
        const html = await page.content();
        return parseHtmlToMarkdown(html, url, onlyMainContent);
    } finally {
        await browser.close();
    }
}

// ============================================
// HTML → Markdown 변환 (공통)
// ============================================

function parseHtmlToMarkdown(html: string, url: string, onlyMainContent: boolean): ScrapeResult {
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;

    // 링크 수집
    const links: string[] = [];
    const anchors = document.querySelectorAll('a[href]');
    anchors.forEach(anchor => {
        const href = anchor.getAttribute('href');
        if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
            links.push(href);
        }
    });

    let title = document.title || '';
    let markdown: string;

    if (onlyMainContent) {
        // Readability로 메인 콘텐츠 추출
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const reader = new Readability(document as any);
        const article = reader.parse();

        if (article && article.content) {
            title = article.title || title;
            markdown = turndown.turndown(article.content);
        } else {
            // Readability 실패 시 body 전체 변환
            markdown = turndown.turndown(document.body?.innerHTML ?? '');
        }
    } else {
        markdown = turndown.turndown(document.body?.innerHTML ?? '');
    }

    return { markdown, title, links };
}

// ============================================
// mapSiteUrls — sitemap.xml + 링크 수집
// ============================================

/**
 * 웹사이트의 URL 구조를 매핑
 *
 * sitemap.xml을 먼저 파싱하고, 없으면 루트 페이지의 링크를 수집합니다.
 *
 * @param url - 매핑할 웹사이트 URL
 * @param options - 매핑 옵션
 * @returns URL 목록
 */
export async function mapSiteUrls(url: string, options: MapOptions = {}): Promise<string[]> {
    checkCircuitBreaker();
    await validateOutboundUrl(url);

    const limit = options.limit ?? 100;
    const urls = new Set<string>();

    const parsedUrl = new URL(url);
    const baseOrigin = parsedUrl.origin;

    // 1. sitemap.xml 시도
    try {
        const sitemapUrl = `${baseOrigin}/sitemap.xml`;
        const response = await safeFetch(sitemapUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OpenMakeBot/1.0)' },
        });

        if (response.ok) {
            const xml = await response.text();
            const locRegex = /<loc>(.*?)<\/loc>/gi;
            let match;
            while ((match = locRegex.exec(xml)) !== null && urls.size < limit) {
                const loc = match[1].trim();
                if (!options.search || loc.includes(options.search)) {
                    urls.add(loc);
                }
            }
        }
    } catch (error) {
        logger.info(`sitemap.xml 파싱 실패: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 2. 루트 페이지 링크 수집 (sitemap이 충분하지 않으면)
    if (urls.size < limit) {
        try {
            const response = await safeFetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OpenMakeBot/1.0)' },
            });

            if (response.ok) {
                const html = await response.text();
                const hrefRegex = /href="(https?:\/\/[^"]+)"/gi;
                let match;
                while ((match = hrefRegex.exec(html)) !== null && urls.size < limit) {
                    const href = match[1];
                    if (href.startsWith(baseOrigin)) {
                        if (!options.search || href.includes(options.search)) {
                            urls.add(href);
                        }
                    }
                }
            }
        } catch (error) {
            logger.info(`루트 페이지 링크 수집 실패: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    recordSuccess();
    return Array.from(urls).slice(0, limit);
}

// ============================================
// crawlSite — BFS 크롤러
// ============================================

/**
 * 웹사이트를 BFS로 크롤링하여 여러 페이지의 콘텐츠를 수집
 *
 * @param url - 크롤링 시작 URL
 * @param options - 크롤링 옵션
 * @returns 크롤링된 페이지 목록
 */
export async function crawlSite(
    url: string,
    options: CrawlOptions = {}
): Promise<{ url: string; markdown: string; title: string }[]> {
    checkCircuitBreaker();
    await validateOutboundUrl(url);

    const maxDepth = options.maxDepth ?? 2;
    const limit = options.limit ?? 10;
    const timeoutMs = options.timeoutMs ?? LLM_TIMEOUTS.WEB_SCRAPE_TIMEOUT_MS;
    const excludePaths = options.excludePaths ?? [];

    const parsedUrl = new URL(url);
    const baseOrigin = parsedUrl.origin;

    const visited = new Set<string>();
    const results: { url: string; markdown: string; title: string }[] = [];
    const queue: { url: string; depth: number }[] = [{ url, depth: 0 }];

    while (queue.length > 0 && results.length < limit) {
        if (options.signal?.aborted) break;

        const current = queue.shift()!;
        const normalizedUrl = current.url.replace(/\/$/, '');

        if (visited.has(normalizedUrl)) continue;
        visited.add(normalizedUrl);

        // 제외 경로 체크
        const shouldExclude = excludePaths.some(pattern => {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            return regex.test(new URL(current.url).pathname);
        });
        if (shouldExclude) continue;

        try {
            const result = await scrapePage(current.url, { timeoutMs, signal: options.signal });
            results.push({
                url: current.url,
                markdown: result.markdown,
                title: result.title,
            });

            // 다음 깊이의 링크를 큐에 추가
            if (current.depth < maxDepth) {
                for (const link of result.links) {
                    if (link.startsWith(baseOrigin) && !visited.has(link.replace(/\/$/, ''))) {
                        queue.push({ url: link, depth: current.depth + 1 });
                    }
                }
            }
        } catch (error) {
            logger.warn(`크롤링 실패 (${current.url}): ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return results;
}

// ============================================
// 서킷 브레이커 상태 조회
// ============================================

export function getScraperCircuitStatus(): {
    isOpen: boolean;
    consecutiveFailures: number;
    remainingResetMs: number;
} {
    return {
        isOpen: circuitState.isOpen,
        consecutiveFailures: circuitState.consecutiveFailures,
        remainingResetMs: circuitState.isOpen
            ? Math.max(0, CIRCUIT_BREAKER_RESET_MS - (Date.now() - circuitState.openedAt))
            : 0,
    };
}
