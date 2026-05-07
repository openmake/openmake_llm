import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const base = 'http://rasplay.tplinkdns.com:52416';
const pages = [
    ['chat', '/'],
    ['history', '/history.html'],
    ['guide', '/guide.html'],
    ['developer', '/developer.html'],
    ['research', '/research.html'],
    ['documents', '/documents.html'],
    ['custom-agents', '/custom-agents.html'],
    ['skill-library', '/skill-library.html'],
    ['memory', '/memory.html'],
    ['usage', '/usage.html'],
    ['agent-learning', '/agent-learning.html'],
    ['api-keys', '/api-keys.html'],
    ['cluster', '/cluster.html'],
    ['admin', '/admin.html'],
    ['admin-metrics', '/admin-metrics.html'],
    ['audit', '/audit.html'],
    ['external', '/external.html'],
    ['analytics', '/analytics.html'],
    ['alerts', '/alerts.html'],
    ['password-change', '/password-change.html'],
    ['token-monitoring', '/token-monitoring.html'],
    ['uir-monitor', '/uir-monitor.html'],
    ['settings', '/settings.html'],
    ['login', '/login.html']
];

const outDir = 'artifacts/ui-review/current';
await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

for (const [name, route] of pages) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const response = await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(error => ({ error }));
    await page.waitForTimeout(1600);
    const finalUrl = page.url();
    const title = await page.title().catch(() => '');
    const info = await page.evaluate(() => {
        const bySel = selector => Array.from(document.querySelectorAll(selector)).map(el => (el.innerText || el.textContent || '').trim()).filter(Boolean).slice(0, 12);
        const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({ href: a.getAttribute('href'), text: (a.innerText || a.textContent || '').trim() })).filter(a => a.text || a.href).slice(0, 30);
        const buttons = bySel('button, [role="button"], input[type="submit"]');
        const headings = bySel('h1,h2,h3');
        const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
        const styles = getComputedStyle(document.body);
        const navItems = Array.from(document.querySelectorAll('nav a, .sidebar a, aside a, [class*="nav"] a')).map(a => (a.innerText || a.textContent || '').trim()).filter(Boolean).slice(0, 30);
        return {
            bodyClass: document.body?.className || '',
            bodyText: bodyText.slice(0, 900),
            textLength: bodyText.length,
            headings,
            buttons,
            links,
            navItems,
            bg: styles.backgroundColor,
            color: styles.color,
            viewport: { w: window.innerWidth, h: window.innerHeight },
            scrollHeight: document.documentElement.scrollHeight,
            components: {
                cards: document.querySelectorAll('[class*="card"], .stat-card, .feature-card').length,
                tables: document.querySelectorAll('table').length,
                forms: document.querySelectorAll('form').length,
                inputs: document.querySelectorAll('input,textarea,select').length,
                modals: document.querySelectorAll('[class*="modal"], dialog').length,
                charts: document.querySelectorAll('canvas, svg').length
            }
        };
    }).catch(error => ({ error: String(error) }));
    const shot = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => null);
    results.push({
        name,
        route,
        status: typeof response?.status === 'function' ? response.status() : null,
        finalUrl,
        title,
        screenshot: shot,
        info
    });
    await page.close();
}

await browser.close();
await fs.writeFile('artifacts/ui-review/observations.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(r => ({ name: r.name, status: r.status, finalUrl: r.finalUrl, title: r.title, headings: r.info.headings, textLength: r.info.textLength, components: r.info.components })), null, 2));
