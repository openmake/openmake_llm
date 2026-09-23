/**
 * 문서 파서 레지스트리 — MIME → 파서. 확장자 if-체인 없이 `Record<mime, Parser>` 하나로 분기한다.
 *
 * 파서는 원본 바이트를 텍스트로 바꾸고, 가능하면 페이지 경계(문자 오프셋)를 함께 돌려준다.
 * 실패는 기계 코드가 붙은 `KnowledgeIngestError` 로 던진다 — 조용히 빈 텍스트를 반환하지 않는다.
 *
 * @module addons/knowledge-runtime/ingestion/parser-registry
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { FAILURE_CODES, KnowledgeIngestError } from './errors';

const execFileAsync = promisify(execFile);

/** 파서가 돌려준 페이지 경계 — 문자 오프셋 [charStart, charEnd) */
export interface ParsedPage {
    page: number;
    charStart: number;
    charEnd: number;
}

export interface ParseResult {
    text: string;
    /** 페이지 경계 — PDF 만. 순수 텍스트·마크다운은 undefined */
    pages?: ParsedPage[];
    pageCount?: number;
    parserId: string;
    parserVersion: string;
}

export interface Parser {
    /** 파서 식별자(버전 컬럼에 저장) */
    id: string;
    parse(buffer: Buffer, opts: ParserOptions): Promise<ParseResult>;
}

export interface ParserOptions {
    /** PDF 텍스트층이 너무 얇은지(스캔본) 판정하는 페이지당 최소 문자 수 — limits 프로필값 */
    minCharsPerPdfPage: number;
    /** 추출 상한(ms) — env */
    timeoutMs: number;
}

/** pdftotext 실행 파일 경로 — env 오버라이드, 없으면 PATH 에서 찾는다(리터럴 절대경로 금지) */
function pdftotextBin(): string {
    return process.env.KNOWLEDGE_PDFTOTEXT_PATH || 'pdftotext';
}

let popplerVersionCache: string | null = null;
async function popplerVersion(): Promise<string> {
    if (popplerVersionCache !== null) return popplerVersionCache;
    try {
        // pdftotext -v 는 버전을 stderr 로 낸다
        const { stderr } = await execFileAsync(pdftotextBin(), ['-v'], { timeout: 5_000 });
        const m = /pdftotext version ([\d.]+)/i.exec(stderr) ?? /poppler[^\d]*([\d.]+)/i.exec(stderr);
        popplerVersionCache = m ? m[1] : 'unknown';
    } catch {
        popplerVersionCache = 'unknown';
    }
    return popplerVersionCache;
}

/**
 * PDF → 텍스트. pdftotext 는 페이지 사이에 `\f`(폼피드)를 넣으므로 그걸로 페이지 경계를 만든다.
 * 거의 모든 페이지의 (트림) 문자 수가 minCharsPerPdfPage 미만이면 텍스트층이 없다고 보고 SCANNED_PDF_UNSUPPORTED.
 */
const pdfParser: Parser = {
    id: 'pdftotext',
    async parse(buffer, opts) {
        const dir = await mkdtemp(join(tmpdir(), 'omk-knowledge-'));
        const src = join(dir, 'in.pdf');
        try {
            await writeFile(src, buffer);
            // 입력은 임시 파일, 출력은 stdout('-'). -enc UTF-8 로 인코딩 고정.
            const { stdout } = await execFileAsync(pdftotextBin(), ['-enc', 'UTF-8', src, '-'], {
                timeout: opts.timeoutMs,
                maxBuffer: 64 * 1024 * 1024,
            });
            const raw = stdout;
            // 폼피드로 페이지 분할 — 마지막 페이지 뒤 폼피드는 빈 조각을 만들 수 있어 걸러낸다.
            const parts = raw.split('\f');
            if (parts.length > 1 && parts[parts.length - 1].trim() === '') parts.pop();
            const pages: ParsedPage[] = [];
            let cursor = 0;
            const pieces: string[] = [];
            for (let i = 0; i < parts.length; i++) {
                const isLast = i === parts.length - 1;
                // 페이지 텍스트 뒤에 개행 구분자를 두어 청크가 페이지를 가로질러도 경계가 남게 한다
                const piece = isLast ? parts[i] : `${parts[i]}\n`;
                const charStart = cursor;
                const charEnd = cursor + piece.length;
                pages.push({ page: i + 1, charStart, charEnd });
                pieces.push(piece);
                cursor = charEnd;
            }
            const text = pieces.join('');
            const thin = pages.filter((p) => text.slice(p.charStart, p.charEnd).trim().length < opts.minCharsPerPdfPage);
            // 텍스트층이 (거의) 전부 비었으면 스캔본 — 빈 텍스트로 저장하지 않는다
            if (pages.length > 0 && thin.length >= pages.length) {
                throw new KnowledgeIngestError(FAILURE_CODES.SCANNED_PDF, 'PDF 텍스트층이 비어 있습니다(스캔본으로 추정)');
            }
            return { text, pages, pageCount: pages.length, parserId: this.id, parserVersion: await popplerVersion() };
        } catch (err) {
            if (err instanceof KnowledgeIngestError) throw err;
            const msg = err instanceof Error ? err.message : String(err);
            throw new KnowledgeIngestError(FAILURE_CODES.EXTRACTION, `PDF 파싱 실패: ${msg}`);
        } finally {
            await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        }
    },
};

/** UTF-8 디코딩 파서(순수 텍스트·마크다운). 깨진 UTF-8·바이너리(NUL 포함)는 FAILED_EXTRACTION */
function textParser(id: string): Parser {
    return {
        id,
        async parse(buffer) {
            let text: string;
            try {
                text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
            } catch {
                throw new KnowledgeIngestError(FAILURE_CODES.EXTRACTION, '유효한 UTF-8 텍스트가 아닙니다');
            }
            // NUL 바이트가 있으면 바이너리로 본다(확장자만 txt 인 파일)
            if (text.includes('\u0000')) {
                throw new KnowledgeIngestError(FAILURE_CODES.EXTRACTION, '바이너리로 판정된 파일입니다');
            }
            return { text, parserId: id, parserVersion: '1' };
        },
    };
}

/** MIME → 파서. 이 표가 곧 지원 MIME 목록이다. */
const REGISTRY: Readonly<Record<string, Parser>> = {
    'application/pdf': pdfParser,
    'text/plain': textParser('text'),
    'text/markdown': textParser('markdown'),
};

/** 레지스트리가 파싱할 수 있는 MIME 목록 */
export function supportedMimeTypes(): string[] {
    return Object.keys(REGISTRY);
}

/** MIME 의 파서 — 없으면 undefined(파이프라인이 FAILED_VALIDATION 으로 마감) */
export function parserFor(mime: string): Parser | undefined {
    return REGISTRY[mime];
}
