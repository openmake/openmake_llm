// 아키텍처 도면 렌더 — docs/architecture/arch.html → PNG.
//
// 2026-08-19 판 arch.png 은 소스 없이 렌더된 단발 PNG 라 나흘 만에 낡았다(Electron
// 제거·legacy-web 제거·cli/desktop-native 추가가 반영되지 않았다). 도면은 HTML 에
// 두고 여기서 다시 뽑는다 — 구조가 바뀌면 arch.html 만 고치고 이 스크립트를 돌린다.
//
//   node docs/architecture/render.mjs
//     → arch.png / arch.en.png     통합 아키텍처 (arch.html)
//     → arch2.png / arch2.en.png   배치 아키텍처 (arch2.html)
//
// playwright 는 e2e 용으로 이미 설치돼 있다(playwright.config.ts). file:// 은 일부
// 환경에서 막히므로 임시 정적 서버를 띄워 그쪽을 찍는다.
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIAGRAMS = [
    { src: 'arch.html', out: { ko: 'arch.png', en: 'arch.en.png' }, w: 1880 },
    { src: 'arch2.html', out: { ko: 'arch2.png', en: 'arch2.en.png' }, w: 2000 },
];
const STAMP = process.env.ARCH_STAMP || new Date().toISOString().slice(0, 10);

for (const d of DIAGRAMS) {
    if (!existsSync(resolve(HERE, d.src))) { console.error(`소스 없음: ${d.src}`); process.exit(1); }
}

let chromium;
try {
    ({ chromium } = await import('playwright'));
} catch {
    console.error('playwright 를 찾지 못했다. 레포 루트에서 npm install 후 다시 실행할 것.');
    process.exit(1);
}

const server = createServer((req, res) => {
    // 도면 HTML 과 그것이 참조하는 같은 폴더의 정적 파일(icons.js 등)만 서빙.
    const name = req.url.split('?')[0].replace(/^\//, '');
    if (!/^[\w.-]+\.(html|js|css)$/.test(name)) { res.writeHead(404).end(); return; }
    const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html';
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
    createReadStream(resolve(HERE, name)).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
try {
    for (const d of DIAGRAMS) {
        for (const lang of ['ko', 'en']) {
            const page = await browser.newPage({ viewport: { width: d.w, height: 1200 }, deviceScaleFactor: 2 });
            await page.addInitScript((s) => { window.__STAMP__ = s; }, STAMP);
            await page.goto(`${origin}/${d.src}?lang=${lang}`, { waitUntil: 'networkidle' });
            await page.screenshot({ path: resolve(HERE, d.out[lang]), fullPage: true });
            await page.close();
            console.log(`${d.out[lang]} — ${lang} · ${STAMP} 기준`);
        }
    }
} finally {
    await browser.close();
    server.close();
}
