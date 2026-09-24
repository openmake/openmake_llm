/**
 * 파서·청커 단위 테스트 — DB 불필요. PDF 는 cupsfilter(macOS)+pdftotext 가 있을 때만 실제 파일로 검증한다.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parserFor, supportedMimeTypes } from '../ingestion/parser-registry';
import { chunkerFor } from '../ingestion/chunker-registry';
import { FAILURE_CODES, KnowledgeIngestError } from '../ingestion/errors';
import type { ChunkerProfile } from '../config/profiles';

const PARSE_OPTS = { minCharsPerPdfPage: 20, timeoutMs: 30_000 };
const CHUNKER: ChunkerProfile = { id: 'test', strategy: 'fixed-token', size: 20, overlap: 5 };

const hasCups = existsSync('/usr/sbin/cupsfilter');
const hasPdftotext = existsSync('/opt/homebrew/bin/pdftotext') || existsSync('/usr/bin/pdftotext');
const pdfIt = hasCups && hasPdftotext ? it : it.skip;

function makePdf(text: string): Buffer {
    const dir = mkdtempSync(join(tmpdir(), 'omk-ktest-'));
    try {
        const txt = join(dir, 'in.txt');
        writeFileSync(txt, text);
        const pdf = execFileSync('/usr/sbin/cupsfilter', [txt], { maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
        return Buffer.from(pdf);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('parser-registry', () => {
    it('supportedMimeTypes 는 pdf·plain·markdown 을 포함한다', () => {
        expect(supportedMimeTypes()).toEqual(expect.arrayContaining(['application/pdf', 'text/plain', 'text/markdown']));
    });

    it('parserFor: 모르는 MIME 은 undefined', () => {
        expect(parserFor('image/png')).toBeUndefined();
    });

    it('text/plain: UTF-8 텍스트를 그대로 반환한다', async () => {
        const r = await parserFor('text/plain')!.parse(Buffer.from('안녕하세요 knowledge', 'utf8'), PARSE_OPTS);
        expect(r.text).toBe('안녕하세요 knowledge');
        expect(r.parserId).toBe('text');
        expect(r.pages).toBeUndefined();
    });

    it('text/plain: NUL 이 든 바이너리는 FAILED_EXTRACTION', async () => {
        await expect(parserFor('text/plain')!.parse(Buffer.from([0x41, 0x00, 0x42]), PARSE_OPTS))
            .rejects.toMatchObject({ code: FAILURE_CODES.EXTRACTION });
    });

    it('text/plain: 깨진 UTF-8 은 FAILED_EXTRACTION', async () => {
        await expect(parserFor('text/plain')!.parse(Buffer.from([0xff, 0xfe, 0xfd]), PARSE_OPTS))
            .rejects.toBeInstanceOf(KnowledgeIngestError);
    });

    it('text/markdown: parserId 가 markdown', async () => {
        const r = await parserFor('text/markdown')!.parse(Buffer.from('# 제목\n본문'), PARSE_OPTS);
        expect(r.parserId).toBe('markdown');
    });

    pdfIt('application/pdf: 텍스트·페이지 경계를 만든다', async () => {
        const buf = makePdf('First page line one.\nFirst page line two.');
        const r = await parserFor('application/pdf')!.parse(buf, PARSE_OPTS);
        expect(r.text).toContain('First page line one');
        expect(r.pages && r.pages.length).toBeGreaterThanOrEqual(1);
        // 페이지 경계가 텍스트 오프셋을 덮는다
        const last = r.pages![r.pages!.length - 1];
        expect(last.charEnd).toBeLessThanOrEqual(r.text.length);
    });

    pdfIt('application/pdf: 텍스트층이 얇으면 SCANNED_PDF_UNSUPPORTED', async () => {
        const buf = makePdf('x');
        // 페이지당 최소 문자 수를 아주 크게 잡아 모든 페이지가 '얇다'고 판정되게 한다
        await expect(parserFor('application/pdf')!.parse(buf, { minCharsPerPdfPage: 100_000, timeoutMs: 30_000 }))
            .rejects.toMatchObject({ code: FAILURE_CODES.SCANNED_PDF });
    });
});

describe('chunker-registry fixed-token', () => {
    const strategy = chunkerFor('fixed-token')!;

    it('빈 텍스트는 청크 0', () => {
        expect(strategy.chunk({ text: '   ', profile: CHUNKER })).toEqual([]);
    });

    it('sequence 는 0부터 연속, 오프셋은 원문과 일치, 해시는 sha256(content)', () => {
        const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
        const chunks = strategy.chunk({ text, profile: CHUNKER });
        expect(chunks.length).toBeGreaterThan(1);
        chunks.forEach((c, i) => {
            expect(c.sequence).toBe(i);
            expect(text.slice(c.charStart, c.charEnd)).toBe(c.content);
            expect(c.contentHash).toBe(createHash('sha256').update(c.content, 'utf8').digest('hex'));
            expect(c.tokenCount).toBeGreaterThan(0);
        });
    });

    it('오버랩>0 이면 다음 청크가 이전 청크 끝보다 앞에서 시작한다', () => {
        const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
        const chunks = strategy.chunk({ text, profile: CHUNKER });
        for (let i = 1; i < chunks.length; i++) {
            expect(chunks[i].charStart).toBeLessThan(chunks[i - 1].charEnd);
        }
    });

    it('페이지 경계를 주면 청크에 페이지 범위가 매겨진다', () => {
        const p1 = 'alpha '.repeat(30);
        const p2 = 'beta '.repeat(30);
        const text = p1 + p2;
        const pages = [
            { page: 1, charStart: 0, charEnd: p1.length },
            { page: 2, charStart: p1.length, charEnd: text.length },
        ];
        const chunks = strategy.chunk({ text, profile: CHUNKER, pages });
        expect(chunks.every((c) => c.pageStart != null && c.pageEnd != null)).toBe(true);
        expect(chunks[0].pageStart).toBe(1);
        expect(chunks[chunks.length - 1].pageEnd).toBe(2);
    });

    it('마크다운은 heading_path 를 계산한다', () => {
        const text = ['# 상위', '내용 시작 부분이다 ' + 'x'.repeat(40), '## 하위', 'y'.repeat(60)].join('\n');
        const chunks = strategy.chunk({ text, profile: { ...CHUNKER, size: 15 }, markdown: true });
        const withPath = chunks.filter((c) => c.headingPath);
        expect(withPath.length).toBeGreaterThan(0);
        // 하위 섹션 청크는 '상위 / 하위' 경로를 가진다
        expect(chunks.some((c) => c.headingPath === '상위 / 하위')).toBe(true);
    });
});
