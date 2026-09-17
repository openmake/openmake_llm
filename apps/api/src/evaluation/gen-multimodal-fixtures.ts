/**
 * 멀티모달 평가 이미지 생성 (F26.5) — SVG 를 sharp 로 PNG 래스터화해 `fixtures/images/` 에 쓴다.
 * 자체 생성 도형·문자라 저작권 문제가 없고, 값이 바뀌면 골든셋 라벨도 함께 바꾼다. 생성물은 커밋한다.
 *
 *   npx ts-node src/evaluation/gen-multimodal-fixtures.ts
 *
 * @module evaluation/gen-multimodal-fixtures
 */
import * as fs from 'fs';
import * as path from 'path';

const OUT_DIR = path.join(__dirname, 'fixtures', 'images');
const W = 640;
const H = 400;
const FONT = 'Helvetica, Arial, sans-serif';

function svg(body: string, w = W, h = H): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#ffffff"/>${body}</svg>`;
}

function barChart(title: string, bars: Array<[string, number]>): string {
    const max = Math.max(...bars.map(([, v]) => v));
    const bw = 90;
    const gap = 50;
    const x0 = 80;
    const base = 330;
    const body = bars.map(([label, v], i) => {
        const x = x0 + i * (bw + gap);
        const h = Math.round((v / max) * 240);
        return `<rect x="${x}" y="${base - h}" width="${bw}" height="${h}" fill="#3b6fd8"/>`
            + `<text x="${x + bw / 2}" y="${base - h - 10}" font-family="${FONT}" font-size="22" text-anchor="middle">${v}</text>`
            + `<text x="${x + bw / 2}" y="${base + 32}" font-family="${FONT}" font-size="24" text-anchor="middle">${label}</text>`;
    }).join('');
    return svg(`<text x="${W / 2}" y="40" font-family="${FONT}" font-size="26" text-anchor="middle">${title}</text><line x1="60" y1="${base}" x2="600" y2="${base}" stroke="#333" stroke-width="2"/>${body}`);
}

const IMAGES: Record<string, string> = {
    'bar-chart.png': barChart('Monthly units sold', [['A', 18], ['B', 35], ['C', 42], ['D', 27]]),
    'line-chart.png': svg(`<text x="320" y="40" font-family="${FONT}" font-size="26" text-anchor="middle">Active users by quarter</text>`
        + '<polyline points="80,320 250,260 420,170 590,80" fill="none" stroke="#d8453b" stroke-width="6"/>'
        + ['Q1', 'Q2', 'Q3', 'Q4'].map((q, i) => `<text x="${80 + i * 170}" y="360" font-family="${FONT}" font-size="22" text-anchor="middle">${q}</text>`).join('')),
    'price-table.png': svg('<rect x="80" y="60" width="480" height="240" fill="none" stroke="#333" stroke-width="2"/>'
        + '<line x1="80" y1="120" x2="560" y2="120" stroke="#333" stroke-width="2"/><line x1="80" y1="180" x2="560" y2="180" stroke="#333"/><line x1="80" y1="240" x2="560" y2="240" stroke="#333"/>'
        + '<line x1="320" y1="60" x2="320" y2="300" stroke="#333" stroke-width="2"/>'
        + [['Item', 'Price (KRW)'], ['Apple', '1,200'], ['Banana', '800'], ['Cherry', '4,500']].map(([a, b], i) =>
            `<text x="200" y="${100 + i * 60}" font-family="${FONT}" font-size="24" text-anchor="middle"${i === 0 ? ' font-weight="bold"' : ''}>${a}</text>`
            + `<text x="440" y="${100 + i * 60}" font-family="${FONT}" font-size="24" text-anchor="middle"${i === 0 ? ' font-weight="bold"' : ''}>${b}</text>`).join('')),
    'invoice-text.png': svg(`<text x="60" y="120" font-family="${FONT}" font-size="34" font-weight="bold">INVOICE</text>`
        + `<text x="60" y="190" font-family="${FONT}" font-size="30">INVOICE NO. 58213</text>`
        + `<text x="60" y="250" font-family="${FONT}" font-size="26">Due date: 2026-10-31</text>`),
    'room-booking-ko.png': svg(`<text x="60" y="170" font-family="Apple SD Gothic Neo, Noto Sans KR, sans-serif" font-size="36">회의실 예약 번호: 7731</text>`
        + `<text x="60" y="240" font-family="Apple SD Gothic Neo, Noto Sans KR, sans-serif" font-size="28">3층 대회의실</text>`),
    'red-circle.png': svg('<circle cx="320" cy="200" r="140" fill="#e02020"/>'),
    'five-squares.png': svg([0, 1, 2, 3, 4].map((i) => `<rect x="${50 + i * 115}" y="150" width="90" height="90" fill="#1f5fd1"/>`).join('')),
    'compare-a.png': svg(`<text x="320" y="230" font-family="${FONT}" font-size="80" text-anchor="middle">A: 17</text>`),
    'compare-b.png': svg(`<text x="320" y="230" font-family="${FONT}" font-size="80" text-anchor="middle">B: 23</text>`),
};
for (let n = 1; n <= 8; n++) {
    IMAGES[`digit-${n}.png`] = svg(`<text x="160" y="230" font-family="${FONT}" font-size="180" text-anchor="middle">${n}</text>`, 320, 320);
}

async function main(): Promise<void> {
    const sharp = (await import('sharp')).default;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const [name, body] of Object.entries(IMAGES)) {
        await sharp(Buffer.from(body)).png({ compressionLevel: 9, palette: true }).toFile(path.join(OUT_DIR, name));
        console.log(`${name} ${fs.statSync(path.join(OUT_DIR, name)).size} bytes`);
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
