/**
 * PDF 첨부 vision 페이지 주입 (2026-08-19)
 *
 * claude.ai/ChatGPT 의 하이브리드 PDF 처리(텍스트 추출 + 페이지 이미지)를 로컬 vLLM
 * 이미지 상한 안에서 재현한다: 첨부 PDF 의 앞쪽 페이지를 pdftoppm 으로 JPEG 렌더해
 * vision(images) 채널에 병행 주입 — 표·차트 등 텍스트 추출로 소실되는 레이아웃을 보강.
 * 전체 본문 문맥은 기존 doc-extractor 텍스트 추출이 계속 담당한다.
 *
 * 반드시 extractAttachedDocuments 이전(data 소거 전)에 호출할 것.
 * pdftoppm(poppler) 미설치·렌더 실패는 graceful skip — 기존 텍스트 경로 무영향.
 *
 * @module services/chat-service/pdf-vision
 */
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../utils/logger';
import { DOC_EXTRACT_LIMITS, PDF_VISION_LIMITS } from '../../config/runtime-limits';
import type { AttachedFileInput } from './attach-context';

const logger = createLogger('PdfVision');
const execFileAsync = promisify(execFile);

/** pdftoppm(poppler) 가용성 — 1회 검사 후 캐시 (doc-extractor 네이티브 OCR 경로와 동일 패턴) */
let pdftoppmAvailable: Promise<boolean> | null = null;
function checkPdftoppm(): Promise<boolean> {
    if (!pdftoppmAvailable) {
        pdftoppmAvailable = execFileAsync('pdftoppm', ['-v']).then(() => true, () => {
            logger.info('[PdfVision] pdftoppm 미설치 — PDF vision 페이지 주입 생략(텍스트 추출만)');
            return false;
        });
    }
    return pdftoppmAvailable;
}

/** pdfinfo 결과 — 총 페이지 수와 첫 페이지 판형(pt). 실패 시 각 항목 undefined. */
interface PdfInfo { pages?: number; longEdgePt?: number }

/** pdfinfo 로 총 페이지 수 + 판형 조회 (실패 시 빈 값 — 안내문 총수 생략·기본 dpi 렌더) */
async function getPdfInfo(pdfPath: string): Promise<PdfInfo> {
    try {
        const { stdout } = await execFileAsync('pdfinfo', [pdfPath], {
            timeout: PDF_VISION_LIMITS.RENDER_TIMEOUT_MS,
        });
        const out = String(stdout);
        const pm = /^Pages:\s+(\d+)/m.exec(out);
        // "Page size:  960.009 x 540 pts" — 페이지마다 다를 수 있으나 pdfinfo 는 첫 페이지 기준.
        const sm = /^Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/m.exec(out);
        return {
            ...(pm ? { pages: parseInt(pm[1], 10) } : {}),
            ...(sm ? { longEdgePt: Math.max(parseFloat(sm[1]), parseFloat(sm[2])) } : {}),
        };
    } catch {
        return {};
    }
}

/**
 * 렌더 인자 선택 — 기본은 dpi 렌더지만, 판형이 커서 예상 픽셀이 상한을 넘으면
 * -scale-to 로 긴 변을 고정한다(작은 페이지를 확대하지 않도록 조건부).
 * 판형을 모르면 기존 동작(dpi)을 유지한다.
 */
function renderScaleArgs(longEdgePt: number | undefined): string[] {
    const cap = PDF_VISION_LIMITS.MAX_EDGE_PX;
    if (longEdgePt && cap > 0) {
        const expectedPx = (longEdgePt / 72) * PDF_VISION_LIMITS.DPI;
        if (expectedPx > cap) return ['-scale-to', String(cap)];
    }
    return ['-r', String(PDF_VISION_LIMITS.DPI)];
}

/** 렌더 산출 jpg 파일명의 페이지 번호 (p-1.jpg / p-01.jpg 숫자 정렬용) */
function pageNumOf(name: string): number {
    const m = /-(\d+)\.jpg$/.exec(name);
    return m ? parseInt(m[1], 10) : 0;
}

export interface PdfVisionResult {
    /** 렌더된 페이지 dataURL — vision(images) 채널에 사용자 이미지 뒤로 병합 */
    images: string[];
    /** fileContext 뒤에 덧붙일 안내문 ('' = 주입 없음).
     *  ⚠️ 세션 캐시(appendCachedAttachContext) 대상에는 넣지 말 것 — 이미지는 이번 턴에만 존재 */
    note: string;
}

const EMPTY: PdfVisionResult = { images: [], note: '' };

/**
 * 첨부 PDF 의 앞쪽 페이지를 JPEG dataURL 로 렌더해 vision 채널 주입분을 만든다.
 * 예산 = min(MAX_PAGES, TOTAL_IMAGE_CAP − 사용자 첨부 이미지 수) 를 PDF 순서대로 소진.
 */
export async function buildPdfVisionAttachment(
    files: AttachedFileInput[] | undefined,
    userImageCount: number,
): Promise<PdfVisionResult> {
    if (!PDF_VISION_LIMITS.ENABLED || !Array.isArray(files)) return EMPTY;
    let budget = Math.min(
        PDF_VISION_LIMITS.MAX_PAGES,
        PDF_VISION_LIMITS.TOTAL_IMAGE_CAP - userImageCount,
    );
    if (budget <= 0) return EMPTY;

    const pdfs = files.filter((f) => {
        if (!f || typeof f.data !== 'string' || f.data.length === 0) return false;
        if (typeof f.content === 'string') return false; // 이미 텍스트 내용 보유 — 추출/렌더 대상 아님
        const i = f.name.lastIndexOf('.');
        const ext = i >= 0 ? f.name.slice(i + 1).toLowerCase() : '';
        return DOC_EXTRACT_LIMITS.PDF_EXTS.includes(ext);
    });
    if (pdfs.length === 0) return EMPTY;
    if (!(await checkPdftoppm())) return EMPTY;

    const images: string[] = [];
    const noteLines: string[] = [];
    for (const f of pdfs) {
        if (budget <= 0) break;
        const buf = Buffer.from(f.data as string, 'base64');
        if (buf.length === 0 || buf.length > DOC_EXTRACT_LIMITS.OCR_MAX_BYTES) continue;
        const dir = path.join(os.tmpdir(), `om-pdfvis-${crypto.randomUUID()}`);
        try {
            await fs.mkdir(dir, { recursive: true });
            const pdfPath = path.join(dir, 'in.pdf');
            await fs.writeFile(pdfPath, buf);
            const { pages: total, longEdgePt } = await getPdfInfo(pdfPath);
            const want = total !== undefined ? Math.min(budget, total) : budget;
            const scaleArgs = renderScaleArgs(longEdgePt);
            await execFileAsync('pdftoppm', [
                '-jpeg', ...scaleArgs,
                '-f', '1', '-l', String(want),
                pdfPath, path.join(dir, 'p'),
            ], { timeout: PDF_VISION_LIMITS.RENDER_TIMEOUT_MS });
            const pages = (await fs.readdir(dir))
                .filter((n) => n.endsWith('.jpg'))
                .sort((a, b) => pageNumOf(a) - pageNumOf(b))
                .slice(0, budget);
            if (pages.length === 0) continue;
            for (const p of pages) {
                const jpg = await fs.readFile(path.join(dir, p));
                images.push(`data:image/jpeg;base64,${jpg.toString('base64')}`);
            }
            budget -= pages.length;
            const range = pages.length === 1 ? '1페이지' : `1–${pages.length}페이지`;
            noteLines.push(`- ${f.name}: ${total !== undefined ? `총 ${total}페이지 중 ` : ''}${range} 이미지 첨부`);
            const scaleLabel = scaleArgs[0] === '-scale-to'
                ? `긴 변 ${scaleArgs[1]}px 로 축소(판형 초과)`
                : `dpi ${PDF_VISION_LIMITS.DPI}`;
            logger.info(`[PdfVision] ${f.name}: ${pages.length}페이지 렌더 주입 (${scaleLabel})`);
        } catch (e) {
            logger.warn(`[PdfVision] ${f.name} 렌더 실패 — 텍스트 추출만 사용: ${e instanceof Error ? e.message : e}`);
        } finally {
            await fs.rm(dir, { recursive: true, force: true }).catch(() => { /* noop */ });
        }
    }
    if (images.length === 0) return EMPTY;
    const note = '\n\n[첨부 PDF 페이지 이미지] 아래 PDF 는 본문 텍스트 추출과 별도로 앞쪽 페이지가 이미지로도 첨부되어 있다. '
        + '표·차트·레이아웃이 필요한 판독은 이미지를 근거로 할 것.\n'
        + noteLines.join('\n');
    return { images, note };
}
