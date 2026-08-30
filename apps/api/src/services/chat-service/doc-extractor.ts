/**
 * 문서 첨부 텍스트 추출 (2026-06-24)
 *
 * PDF → opendataloader-pdf(Java/JVM, 고품질 마크다운), office → officeparser(순수 Node).
 * 클라이언트가 보낸 base64 원본(file.data)을 텍스트로 추출해 file.content 를 채운다.
 * 추출 성공/실패와 무관하게 data 는 제거(중복 전송·메모리 방지). 실패 시 content 미설정
 * → buildFileContext 가 바이너리 메타만 주입(환각 방지). 전송 계층(WS/REST) 무관.
 *
 * @module services/chat-service/doc-extractor
 */
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../utils/logger';
import { DOC_EXTRACT_LIMITS, FILE_ATTACH_LIMITS } from '../../config/runtime-limits';
import type { AttachedFileInput } from './attach-context';
import type { SupportedFileType } from 'officeparser';

const logger = createLogger('DocExtractor');
const execFileAsync = promisify(execFile);

/** 파일명에서 소문자 확장자 추출 ('' = 확장자 없음) */
function extOf(name: string): string {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/**
 * 이 이름/크기 조합이 생성 시점 추출 대상인지 — 라우트(multipart)·chunk-store(claim)의
 * 사전 게이트용 단일 규칙. 일반 상한(MAX_BYTES_PER_FILE) 이내이거나, PDF+OCR 활성이면
 * OCR_MAX_BYTES 까지 허용(본문 루프의 ocrOnly 분기와 동일 기준 — 비대칭 금지).
 */
export function isExtractableSize(name: string, size: number): boolean {
    if (size <= 0) return false;
    if (size <= DOC_EXTRACT_LIMITS.MAX_BYTES_PER_FILE) return true;
    return DOC_EXTRACT_LIMITS.PDF_EXTS.includes(extOf(name)) && DOC_EXTRACT_LIMITS.OCR_ENABLED
        && size <= DOC_EXTRACT_LIMITS.OCR_MAX_BYTES;
}

/**
 * Promise 에 타임아웃을 건다. 초과 시 reject (원 작업은 백그라운드에 남을 수 있으나 호출자가 graceful 처리).
 * PDF 는 JVM child process 라 강제 종료가 어려워, 과대 파일은 MAX_BYTES_PER_FILE 로 사전 차단한다.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} 추출 타임아웃 (${ms}ms)`)), ms);
        p.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e) => { clearTimeout(timer); reject(e); },
        );
    });
}

/** PDF → markdown (opendataloader-pdf, JVM). 입력은 파일 경로만 받으므로 임시파일 경유. */
async function extractPdf(buf: Buffer): Promise<string> {
    const { convert } = await import('@opendataloader/pdf');
    const tmp = path.join(os.tmpdir(), `om-pdf-${crypto.randomUUID()}.pdf`);
    await fs.writeFile(tmp, buf);
    try {
        const out = await withTimeout(
            convert(tmp, { format: 'markdown', toStdout: true, quiet: true }),
            DOC_EXTRACT_LIMITS.PDF_TIMEOUT_MS,
            'PDF',
        );
        const text = typeof out === 'string' ? out : '';
        // 텍스트 레이어가 충분하면 그대로 사용. 추출량이 매우 적으면 스캔본(이미지 PDF)으로
        // 보고 OCR 폴백 — opendataloader 는 OCR 미지원이므로 officeparser+tesseract 로 재시도.
        if (text.trim().length >= DOC_EXTRACT_LIMITS.PDF_MIN_TEXT_CHARS || !DOC_EXTRACT_LIMITS.OCR_ENABLED) {
            return text;
        }
        logger.info(`[DocExtract] PDF 텍스트 레이어 부족(${text.trim().length}자) — 스캔본 의심, OCR 폴백 시도`);
        try {
            const ocrText = await extractPdfOcr(buf);
            return ocrText.trim().length > text.trim().length ? ocrText : text;
        } catch (e) {
            logger.warn(`[DocExtract] PDF OCR 폴백 실패: ${e instanceof Error ? e.message : e}`);
            return text;
        }
    } finally {
        await fs.unlink(tmp).catch(() => { /* noop */ });
    }
}

/** 네이티브 OCR 바이너리(pdftoppm+tesseract) 가용성 — 1회 검사 후 캐시. */
let nativeOcrAvailable: Promise<boolean> | null = null;
function checkNativeOcr(): Promise<boolean> {
    if (!nativeOcrAvailable) {
        nativeOcrAvailable = Promise.all([
            execFileAsync('pdftoppm', ['-v']),
            execFileAsync('tesseract', ['--version']),
        ]).then(() => true, () => {
            logger.warn('[DocExtract] pdftoppm/tesseract 미설치 — 스캔본 OCR 은 구 경로(sips+tesseract.js, 첫 페이지만)로 폴백');
            return false;
        });
    }
    return nativeOcrAvailable;
}

/**
 * 스캔본 PDF → text (네이티브 pdftoppm 래스터화 + tesseract 병렬 OCR, 다중 페이지).
 * 생성 시점 동기 경로이므로 OCR_MAX_PAGES·OCR_TIMEOUT_MS 예산 안에서만 처리 —
 * 잔여 페이지는 원본이 샌드박스로 전달돼 에이전트가 컨테이너 내 tesseract 로 이어서 처리.
 */
async function extractPdfOcrNative(buf: Buffer): Promise<string> {
    const dir = path.join(os.tmpdir(), `om-ocr-${crypto.randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    try {
        const pdf = path.join(dir, 'in.pdf');
        await fs.writeFile(pdf, buf);
        await execFileAsync('pdftoppm', [
            '-r', String(DOC_EXTRACT_LIMITS.OCR_DPI), '-gray', '-jpeg',
            '-f', '1', '-l', String(DOC_EXTRACT_LIMITS.OCR_MAX_PAGES),
            pdf, path.join(dir, 'p'),
        ], { timeout: DOC_EXTRACT_LIMITS.PDF_TIMEOUT_MS });
        const pages = (await fs.readdir(dir)).filter((f) => f.endsWith('.jpg')).sort();
        if (pages.length === 0) return '';

        const { parallelBatch } = await import('../../workflow/graph-engine');
        const run = parallelBatch(pages, async (img) => {
            const base = path.join(dir, img.replace(/\.jpg$/, ''));
            await execFileAsync('tesseract', [
                path.join(dir, img), base, '-l', DOC_EXTRACT_LIMITS.OCR_LANGS, '--psm', '3',
            ], { timeout: DOC_EXTRACT_LIMITS.OCR_TIMEOUT_MS });
            return `--- PAGE ${img.replace(/^p-0*|\.jpg$/g, '')} ---\n${await fs.readFile(`${base}.txt`, 'utf8')}`;
        }, { concurrency: DOC_EXTRACT_LIMITS.OCR_PARALLEL });
        const results = await withTimeout(run, DOC_EXTRACT_LIMITS.OCR_TIMEOUT_MS, 'PDF OCR(native)');
        return results.filter((r): r is string => typeof r === 'string').join('\n');
    } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => { /* noop */ });
    }
}

/** OCR 디스패처 — 네이티브 가능 시 다중 페이지, 아니면 구 경로(첫 페이지). */
async function extractPdfOcr(buf: Buffer): Promise<string> {
    return (await checkNativeOcr()) ? extractPdfOcrNative(buf) : extractPdfOcrLegacy(buf);
}

/**
 * [구 경로] 스캔본 PDF → text (sips 로 페이지 래스터화 후 tesseract.js OCR).
 * officeparser 의 PDF OCR 은 페이지를 통째로 래스터화하지 않아(임베드 이미지 객체만 처리)
 * 스캔본을 못 읽으므로, macOS 내장 sips 로 PDF→PNG 변환 후 tesseract 로 직접 인식한다.
 * (운영 서버가 macOS 확정 — opendataloader JVM 과 동일하게 환경 종속. 다중 페이지 PDF 는
 * sips 가 첫 페이지만 변환하므로 첫 페이지 위주로 인식된다.)
 */
async function extractPdfOcrLegacy(buf: Buffer): Promise<string> {
    const id = crypto.randomUUID();
    const tmpPdf = path.join(os.tmpdir(), `om-ocr-${id}.pdf`);
    const tmpPng = path.join(os.tmpdir(), `om-ocr-${id}.png`);
    await fs.writeFile(tmpPdf, buf);
    try {
        // PDF → PNG 래스터화 (macOS sips)
        await execFileAsync('sips', ['-s', 'format', 'png', tmpPdf, '--out', tmpPng], {
            timeout: DOC_EXTRACT_LIMITS.PDF_TIMEOUT_MS,
        });
        // tesseract.js OCR (officeparser 의 트랜지티브 의존 — 별도 설치 불필요)
        const { createWorker } = await import('tesseract.js');
        const worker = await createWorker(DOC_EXTRACT_LIMITS.OCR_LANGS);
        try {
            const { data } = await withTimeout(
                worker.recognize(tmpPng),
                DOC_EXTRACT_LIMITS.OCR_TIMEOUT_MS,
                'PDF OCR',
            );
            return data.text || '';
        } finally {
            await worker.terminate();
        }
    } finally {
        await fs.unlink(tmpPdf).catch(() => { /* noop */ });
        await fs.unlink(tmpPng).catch(() => { /* noop */ });
    }
}

/** office 포맷(docx/xlsx/pptx/odt/...) → plain text (officeparser, 순수 Node). buffer 직접 처리. */
/**
 * 한국 공문서(HWP 3.x/5.x·HWPX·HWPML) → 마크다운.
 *
 * kordoc 은 순수 JS 파서라 한컴오피스·Windows COM·JVM 이 필요 없다(PDF 경로의 JVM 과 대비).
 * `parse()` 가 이미 `markdown` 을 만들어 주므로 블록을 다시 조립하지 않는다.
 * 파싱 자체가 실패하면 throw — 호출부가 잡아 메타만 남긴다(기존 형식들과 동일).
 */
async function extractHwp(buf: Buffer, name: string): Promise<string> {
    const { parse } = await import('kordoc');
    // 형식은 매직바이트로 자동 판별된다(ParseOptions 에 filename 이 없다) — 확장자는 로그용.
    const r = await withTimeout(parse(buf), DOC_EXTRACT_LIMITS.HWP_TIMEOUT_MS, 'HWP');
    const md = typeof (r as { markdown?: unknown })?.markdown === 'string' ? (r as { markdown: string }).markdown : '';
    // 암호화 문서 등은 success=false 로 오며 markdown 이 비어 있다 — 경고만 남기고 빈 문자열.
    if (!md && Array.isArray((r as { warnings?: unknown[] })?.warnings)) {
        const w = (r as { warnings: unknown[] }).warnings.slice(0, 3).join('; ');
        if (w) logger.warn(`[DocExtract] ${name}: kordoc 경고 — ${w}`);
    }
    return md;
}

async function extractOffice(buf: Buffer, ext: string): Promise<string> {
    const { parseOffice } = await import('officeparser');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOC_EXTRACT_LIMITS.OFFICE_TIMEOUT_MS);
    try {
        // buffer 입력 시 magic byte 외에 확장자 힌트 제공 (officeparser 권장).
        // ext 는 호출 전 OFFICE_EXTS 화이트리스트로 검증됨 → SupportedFileType 캐스팅 안전.
        const ast = await parseOffice(buf, {
            fileType: ext as SupportedFileType,
            abortSignal: controller.signal,
        });
        // toText() 는 deprecated → to('md') 로 구조 보존 마크다운 추출
        return (await ast.to('md')).value;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * files[] 의 data(base64 문서)를 텍스트로 추출해 content 를 채운다 (in-place mutate).
 * - 이미 content 가 있으면 추출 생략
 * - 추출 대상 아닌 확장자/과대 파일/추출 실패 → content 미설정(메타 처리)
 * - 성공 시 FILE_ATTACH_LIMITS.MAX_CHARS_PER_FILE 로 절단
 */
export async function extractAttachedDocuments(files: AttachedFileInput[] | undefined): Promise<void> {
    if (!DOC_EXTRACT_LIMITS.ENABLED || !Array.isArray(files)) return;

    for (const f of files) {
        if (!f || typeof f.data !== 'string' || f.data.length === 0) continue;
        // 이미 텍스트 내용이 있으면 추출 불필요
        if (typeof f.content === 'string') { delete f.data; continue; }

        const ext = extOf(typeof f.name === 'string' ? f.name : '');
        const isPdf = DOC_EXTRACT_LIMITS.PDF_EXTS.includes(ext);
        const isOffice = DOC_EXTRACT_LIMITS.OFFICE_EXTS.includes(ext);
        const isHwp = DOC_EXTRACT_LIMITS.HWP_EXTS.includes(ext);
        if (!isPdf && !isOffice && !isHwp) { delete f.data; continue; }

        const buf = Buffer.from(f.data, 'base64');
        // PDF 는 MAX_BYTES_PER_FILE(JVM 보호) 초과라도 OCR_MAX_BYTES 까지는 OCR 직행 허용 —
        // opendataloader 만 생략(디스크 경유 래스터화라 메모리 안전). 스캔 대형 문서가
        // "추출 생략 → 빈 컨텍스트" 로 떨어지던 갭 해소(2026-08-04).
        // (에이전트 작업의 대형 첨부는 라우트/claim 이 30MB 게이트로 이 함수 호출 자체를
        //  생략한다 — 생성 응답이 CF 100s 를 넘지 않도록. 여기 ocrOnly 는 그 이하 경로용.)
        const withinFull = buf.length <= DOC_EXTRACT_LIMITS.MAX_BYTES_PER_FILE;
        if (buf.length === 0 || !isExtractableSize(typeof f.name === 'string' ? f.name : '', buf.length)) {
            logger.warn(`[DocExtract] ${f.name}: 크기 초과/빈 파일 (${buf.length}B) — 추출 생략`);
            delete f.data;
            continue;
        }

        try {
            const text = isPdf
                ? (withinFull ? await extractPdf(buf) : await extractPdfOcr(buf))
                : isHwp
                    ? await extractHwp(buf, typeof f.name === 'string' ? f.name : `doc.${ext}`)
                    : await extractOffice(buf, ext);
            const trimmed = (text || '').trim();
            if (trimmed.length > 0) {
                f.content = trimmed.slice(0, FILE_ATTACH_LIMITS.MAX_CHARS_PER_FILE);
                if (trimmed.length > FILE_ATTACH_LIMITS.MAX_CHARS_PER_FILE) f.truncated = true;
                logger.info(`[DocExtract] ${f.name} (${ext}) → ${f.content.length}자 추출`);
            } else {
                logger.info(`[DocExtract] ${f.name} (${ext}): 추출 텍스트 없음(스캔본/이미지 가능) — 메타만`);
            }
        } catch (e) {
            logger.warn(`[DocExtract] ${f.name} 추출 실패: ${e instanceof Error ? e.message : e}`);
            // content 미설정 → buildFileContext 가 바이너리 메타로 처리
        } finally {
            delete f.data;
        }
    }
}
