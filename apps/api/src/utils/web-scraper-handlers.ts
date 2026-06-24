/**
 * ============================================================
 * Web Scraper Handlers — 구조화 소스 · 차단우회 · RSS 폴백
 * ============================================================
 * scrapePage 의 보조 경로:
 *  - resolveStructuredSource: YouTube oEmbed · HN Algolia (공개 API, safeFetch)
 *  - resolveBlockedSource: Reddit (curl_cffi 임퍼소네이션, 플래그 OFF 기본)
 *  - tryRssFallback: 본문 0일 때 RSS 피드 탐지·파싱
 *
 * 모든 일반 외부 호출은 safeFetch(SSRF guard) 경유. 차단우회는 impersonateFetch 가
 * 자체 SSRF 정합(화이트리스트+고정IP+no-redirect)을 수행한다.
 *
 * @module utils/web-scraper-handlers
 */
import { JSDOM } from 'jsdom';
import { safeFetch } from '../security/ssrf-guard';
import { impersonateFetch } from './impersonate-fetch';
import { SCRAPER_CONFIG, browserHeaders } from '../config/web-scraper';
import { createLogger } from './logger';
import type { ScrapeResult } from './web-scraper';

const logger = createLogger('ScraperHandlers');

// ============================================
// 구조화 소스 핸들러 (공개 API)
// ============================================

/** YouTube → oEmbed 메타(제목·채널). 자막은 불안정해 미포함(best-effort 메타만). */
async function youtubeHandler(url: string): Promise<ScrapeResult | null> {
    const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await safeFetch(oembed, { headers: browserHeaders() });
    if (!res.ok) return null;
    const j = await res.json() as { title?: string; author_name?: string; author_url?: string; thumbnail_url?: string };
    if (!j.title) return null;
    const markdown = `# ${j.title}\n\n` +
        (j.author_name ? `**채널:** ${j.author_name}\n\n` : '') +
        (j.thumbnail_url ? `![thumbnail](${j.thumbnail_url})\n\n` : '') +
        `원본 영상: ${url}\n\n` +
        `(YouTube 메타데이터 — 영상 자막/본문은 포함되지 않음)`;
    return { markdown, title: j.title, links: [j.author_url, url].filter((x): x is string => !!x) };
}

interface HnItem {
    title?: string;
    text?: string;
    url?: string;
    author?: string;
    points?: number;
    children?: HnItem[];
}

/** HN 댓글 트리를 들여쓰기 markdown 으로 (깊이·개수 제한). */
function renderHnComments(items: HnItem[] | undefined, depth: number, budget: { left: number }): string {
    if (!items || depth > 4 || budget.left <= 0) return '';
    let out = '';
    for (const c of items) {
        if (budget.left <= 0) break;
        if (!c.text) continue;
        budget.left -= 1;
        const indent = '  '.repeat(depth);
        const text = c.text.replace(/<[^>]+>/g, '').slice(0, 800);
        out += `${indent}- **${c.author || '익명'}:** ${text}\n`;
        out += renderHnComments(c.children, depth + 1, budget);
    }
    return out;
}

/** Hacker News → Algolia items API (제목·본문·상위 댓글). */
async function hnHandler(url: string): Promise<ScrapeResult | null> {
    const m = url.match(/item\?id=(\d+)/);
    if (!m) return null;
    const res = await safeFetch(`https://hn.algolia.com/api/v1/items/${m[1]}`, { headers: browserHeaders() });
    if (!res.ok) return null;
    const item = await res.json() as HnItem;
    if (!item.title) return null;
    const body = (item.text || '').replace(/<[^>]+>/g, '');
    const comments = renderHnComments(item.children, 0, { left: 30 });
    const markdown = `# ${item.title}\n\n` +
        (item.url ? `링크: ${item.url}\n\n` : '') +
        (body ? `${body}\n\n` : '') +
        (comments ? `## 댓글\n\n${comments}` : '');
    return { markdown, title: item.title, links: item.url ? [item.url] : [] };
}

// ============================================
// 차단 우회 핸들러 (impersonate)
// ============================================

interface RedditThing { data?: Record<string, unknown>; kind?: string }
interface RedditListing { data?: { children?: RedditThing[] } }

/** Reddit → .json (curl_cffi 임퍼소네이션). 게시글 본문 + 상위 댓글. */
async function redditHandler(url: string): Promise<ScrapeResult | null> {
    // 쿼리/해시 제거 후 .json 부착
    const u = new URL(url);
    const jsonUrl = `${u.origin}${u.pathname.replace(/\/$/, '')}.json`;
    const res = await impersonateFetch(jsonUrl);
    if (!res || res.status !== 200) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(res.body);
    } catch {
        return null;
    }
    if (!Array.isArray(parsed) || parsed.length < 1) return null;

    const postListing = parsed[0] as RedditListing;
    const post = postListing.data?.children?.[0]?.data as Record<string, string> | undefined;
    if (!post) return null;
    const title = String(post.title || '');
    const selftext = String(post.selftext || '');

    let comments = '';
    if (parsed.length >= 2) {
        const commentListing = parsed[1] as RedditListing;
        const children = commentListing.data?.children || [];
        let count = 0;
        for (const c of children) {
            if (count >= 20) break;
            const body = c.data?.body as string | undefined;
            const author = c.data?.author as string | undefined;
            if (!body) continue;
            count += 1;
            comments += `- **${author || '익명'}:** ${body.slice(0, 800)}\n`;
        }
    }
    const markdown = `# ${title}\n\n` +
        (selftext ? `${selftext}\n\n` : '') +
        (comments ? `## 댓글\n\n${comments}` : '');
    return { markdown, title, links: [] };
}

// ============================================
// 레지스트리
// ============================================

const STRUCTURED_HANDLERS: Array<{ match: (u: URL) => boolean; handler: (url: string) => Promise<ScrapeResult | null> }> = [
    { match: (u) => /(?:^|\.)youtube\.com$/.test(u.hostname) && u.pathname === '/watch', handler: youtubeHandler },
    { match: (u) => u.hostname === 'youtu.be', handler: youtubeHandler },
    { match: (u) => u.hostname === 'news.ycombinator.com' && u.pathname === '/item', handler: hnHandler },
];

const BLOCKED_HANDLERS: Array<{ match: (u: URL) => boolean; handler: (url: string) => Promise<ScrapeResult | null> }> = [
    { match: (u) => /(?:^|\.)reddit\.com$/.test(u.hostname), handler: redditHandler },
];

function safeUrl(url: string): URL | null {
    try { return new URL(url); } catch { return null; }
}

/** YouTube/HN 등 공개 구조화 소스 — 매칭+성공 시 ScrapeResult, 아니면 null. */
export async function resolveStructuredSource(url: string): Promise<ScrapeResult | null> {
    if (!SCRAPER_CONFIG.STRUCTURED_SOURCE_ENABLED) return null;
    const u = safeUrl(url);
    if (!u) return null;
    for (const h of STRUCTURED_HANDLERS) {
        if (h.match(u)) {
            try {
                return await h.handler(url);
            } catch (e) {
                logger.warn(`[structured] ${u.hostname} 핸들러 실패: ${e instanceof Error ? e.message : e}`);
                return null;
            }
        }
    }
    return null;
}

/** Reddit 등 차단 사이트 — impersonate 활성 시에만. 매칭+성공 시 ScrapeResult. */
export async function resolveBlockedSource(url: string): Promise<ScrapeResult | null> {
    if (!SCRAPER_CONFIG.IMPERSONATE_ENABLED) return null;
    const u = safeUrl(url);
    if (!u) return null;
    for (const h of BLOCKED_HANDLERS) {
        if (h.match(u)) {
            try {
                return await h.handler(url);
            } catch (e) {
                logger.warn(`[blocked] ${u.hostname} 핸들러 실패: ${e instanceof Error ? e.message : e}`);
                return null;
            }
        }
    }
    return null;
}

// ============================================
// RSS 폴백
// ============================================

/** HTML 에서 RSS/Atom 피드 URL 후보를 찾는다. */
function findFeedCandidates(html: string, origin: string): string[] {
    const candidates: string[] = [];
    try {
        const doc = new JSDOM(html).window.document;
        doc.querySelectorAll('link[rel="alternate"]').forEach((l) => {
            const type = (l.getAttribute('type') || '').toLowerCase();
            const href = l.getAttribute('href');
            if (href && (type.includes('rss') || type.includes('atom') || type.includes('xml'))) {
                try { candidates.push(new URL(href, origin).toString()); } catch { /* skip */ }
            }
        });
    } catch { /* skip */ }
    // 관례적 경로 폴백
    candidates.push(`${origin}/feed`, `${origin}/rss`, `${origin}/atom.xml`, `${origin}/feed.xml`);
    return [...new Set(candidates)];
}

/** RSS/Atom XML → 항목 제목·요약 markdown. */
function parseFeed(xml: string): ScrapeResult | null {
    let doc: Document;
    try {
        doc = new JSDOM(xml, { contentType: 'text/xml' }).window.document;
    } catch {
        return null;
    }
    const channelTitle = doc.querySelector('channel > title, feed > title')?.textContent?.trim() || '피드';
    const items = Array.from(doc.querySelectorAll('item, entry')).slice(0, 20);
    if (items.length === 0) return null;
    let markdown = `# ${channelTitle}\n\n`;
    for (const it of items) {
        const t = it.querySelector('title')?.textContent?.trim() || '(제목 없음)';
        const link = it.querySelector('link')?.textContent?.trim()
            || it.querySelector('link')?.getAttribute('href') || '';
        const desc = (it.querySelector('description, summary, content')?.textContent || '')
            .replace(/<[^>]+>/g, '').trim().slice(0, 300);
        markdown += `## ${t}\n${link ? link + '\n' : ''}${desc ? desc + '\n' : ''}\n`;
    }
    return { markdown, title: channelTitle, links: [] };
}

/** 본문 추출 실패 시 RSS 피드로 폴백. */
export async function tryRssFallback(url: string): Promise<ScrapeResult | null> {
    if (!SCRAPER_CONFIG.RSS_FALLBACK_ENABLED) return null;
    const u = safeUrl(url);
    if (!u) return null;
    // 원 페이지 HTML 에서 피드 링크 탐지 (실패해도 관례 경로 시도)
    let html = '';
    try {
        const res = await safeFetch(url, { headers: browserHeaders() });
        if (res.ok) html = await res.text();
    } catch { /* 관례 경로로 진행 */ }

    for (const feedUrl of findFeedCandidates(html, u.origin)) {
        try {
            const res = await safeFetch(feedUrl, { headers: browserHeaders() });
            if (!res.ok) continue;
            const xml = await res.text();
            if (!/<(rss|feed|channel)\b/i.test(xml)) continue;
            const parsed = parseFeed(xml);
            if (parsed && parsed.markdown.trim().length > 0) {
                logger.info(`[rss] 폴백 성공: ${feedUrl}`);
                return parsed;
            }
        } catch { /* 다음 후보 */ }
    }
    return null;
}
