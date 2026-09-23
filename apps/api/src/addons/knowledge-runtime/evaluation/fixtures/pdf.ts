/**
 * K08 PDF 픽스처 생성 — 빌드/실행 시점에 로컬 도구로 만든다(체크인된 바이너리 없음).
 *
 *  - 텍스트층 PDF: macOS `cupsfilter`(texttopdf)로 .txt → PDF(영문). 없거나 실패하면 손수 만든 텍스트 PDF 로 폴백.
 *    (poppler `pdftotext` 가 그대로 추출할 수 있어야 파이프라인의 정상 PDF 수집 경로를 태운다)
 *  - 스캔본 PDF: 텍스트 연산자가 전혀 없는(사각형만 그리는) 최소 PDF — pdftotext 가 빈 텍스트를 내
 *    파이프라인이 SCANNED_PDF_UNSUPPORTED 로 마감한다.
 *
 * @module addons/knowledge-runtime/evaluation/fixtures/pdf
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** PDF 오브젝트 목록으로 xref/trailer 를 갖춘 유효한 PDF 를 조립한다(바이트 오프셋 계산). */
function assemblePdf(objectBodies: string[]): Buffer {
    const header = '%PDF-1.4\n';
    let body = header;
    const offsets: number[] = [];
    objectBodies.forEach((obj, i) => {
        offsets.push(Buffer.byteLength(body, 'latin1'));
        body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xrefStart = Buffer.byteLength(body, 'latin1');
    const count = objectBodies.length + 1;
    let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (const off of offsets) xref += `${off.toString().padStart(10, '0')} 00000 n \n`;
    const trailer = `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
    return Buffer.from(body + xref + trailer, 'latin1');
}

/** 텍스트 연산자가 없는(사각형만) 최소 PDF — 텍스트층 없음 → SCANNED_PDF_UNSUPPORTED 유도 */
export function scannedPdfBytes(): Buffer {
    const content = '50 50 100 100 re f';
    return assemblePdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << >> >>',
        `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    ]);
}

/** PDF 문자열 이스케이프(괄호·역슬래시) */
function pdfEscape(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** 손수 만든 텍스트층 PDF(폴백) — 표준 Helvetica, ASCII 만. 각 줄을 Tj 로 그린다. */
function handcraftedTextPdf(text: string): Buffer {
    const lines = text.split('\n').map((l) => l.replace(/[^\x20-\x7e]/g, '').slice(0, 110)).filter((l) => l.length > 0);
    let ty = 760;
    const ops: string[] = ['BT', '/F1 12 Tf', '14 TL', `36 ${ty} Td`];
    lines.forEach((line, i) => {
        if (i > 0) ops.push('T*');
        ops.push(`(${pdfEscape(line)}) Tj`);
        ty -= 14;
    });
    ops.push('ET');
    const content = ops.join('\n');
    return assemblePdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    ]);
}

/** cupsfilter 로 .txt → PDF. 없거나 실패하면 손수 만든 PDF 로 폴백한다. */
export async function buildTextLayerPdf(text: string): Promise<Buffer> {
    const bin = process.env.KNOWLEDGE_EVAL_CUPSFILTER || 'cupsfilter';
    const dir = await mkdtemp(join(tmpdir(), 'k08-pdf-'));
    const src = join(dir, 'in.txt');
    try {
        await writeFile(src, text, 'utf8');
        const { stdout } = await execFileAsync(bin, [src], { timeout: 30_000, maxBuffer: 32 * 1024 * 1024, encoding: 'buffer' });
        const buf = stdout as unknown as Buffer;
        if (buf && buf.length > 200 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return buf;
        return handcraftedTextPdf(text);
    } catch {
        return handcraftedTextPdf(text);
    } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
}
