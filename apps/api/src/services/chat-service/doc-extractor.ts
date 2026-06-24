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
import { createLogger } from '../../utils/logger';
import { DOC_EXTRACT_LIMITS, FILE_ATTACH_LIMITS } from '../../config/runtime-limits';
import type { AttachedFileInput } from './attach-context';
import type { SupportedFileType } from 'officeparser';

const logger = createLogger('DocExtractor');

/** 파일명에서 소문자 확장자 추출 ('' = 확장자 없음) */
function extOf(name: string): string {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
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
        return typeof out === 'string' ? out : '';
    } finally {
        await fs.unlink(tmp).catch(() => { /* noop */ });
    }
}

/** office 포맷(docx/xlsx/pptx/odt/...) → plain text (officeparser, 순수 Node). buffer 직접 처리. */
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
        if (!isPdf && !isOffice) { delete f.data; continue; }

        const buf = Buffer.from(f.data, 'base64');
        if (buf.length === 0 || buf.length > DOC_EXTRACT_LIMITS.MAX_BYTES_PER_FILE) {
            logger.warn(`[DocExtract] ${f.name}: 크기 초과/빈 파일 (${buf.length}B) — 추출 생략`);
            delete f.data;
            continue;
        }

        try {
            const text = isPdf ? await extractPdf(buf) : await extractOffice(buf, ext);
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
