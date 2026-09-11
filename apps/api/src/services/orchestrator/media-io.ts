/**
 * @module services/orchestrator/media-io
 * @description executor 공용 미디어 입출력 — 첨부(base64 / `/generated` 경로 / https) 로드, dataURL 변환, 결과 저장.
 */
import * as fs from 'node:fs';
import { resolveGeneratedPath, saveGeneratedFile } from '../../mcp/generated-media';
import { downloadProviderUrl } from './http-call';
import { inferImageMime } from '../../utils/image-mime';
import type { OrchestratorAttachment, TaskMedia } from './types';

export interface LoadedMedia { bytes: Buffer; mime: string; name: string; dataUrl: string }

export interface LoadOptions {
    timeoutMs: number;
    signal?: AbortSignal;
    /** 바이트 상한 — 초과는 로드 전에(base64 길이·stat·content-length) 거부 */
    maxBytes: number;
    /** 허용 content-type 접두(https 다운로드 검증) */
    allowTypes: readonly string[];
}

export async function loadAttachment(a: OrchestratorAttachment, opts: LoadOptions): Promise<LoadedMedia> {
    if (opts.signal?.aborted) throw new Error('취소됨');
    if (a.base64) {
        const m = /^data:([^;]+);base64,(.*)$/s.exec(a.base64);
        const raw = m ? m[2] : a.base64;
        // base64 길이로 디코드 전 상한 검사 (3/4 비율)
        if (raw.length * 0.75 > opts.maxBytes) throw new Error(`첨부 '${a.id}' 가 너무 큽니다 (>${opts.maxBytes}B)`);
        const bytes = Buffer.from(raw, 'base64');
        const mime = m ? m[1] : (a.mime || inferImageMime(raw));
        return { bytes, mime, name: a.name, dataUrl: `data:${mime};base64,${raw}` };
    }
    if (a.urlPath) {
        if (a.urlPath.startsWith('/generated/')) {
            const abs = resolveGeneratedPath(a.urlPath);
            if (!abs) throw new Error(`찾을 수 없는 파일: ${a.urlPath}`);
            const size = fs.statSync(abs).size;
            if (size > opts.maxBytes) throw new Error(`파일 '${a.urlPath}' 가 너무 큽니다 (${size}B > ${opts.maxBytes}B)`);
            const bytes = fs.readFileSync(abs);
            const mime = a.mime || mimeFromName(a.urlPath) || inferImageMime(bytes.toString('base64', 0, 64));
            return { bytes, mime, name: a.urlPath.split('/').pop() ?? a.name, dataUrl: `data:${mime};base64,${bytes.toString('base64')}` };
        }
        if (/^https?:\/\//i.test(a.urlPath)) {
            // SSRF 고정 fetch + content-type·크기 검증 (공통 호출 경계)
            const { bytes, contentType } = await downloadProviderUrl(a.urlPath, {
                timeoutMs: opts.timeoutMs, signal: opts.signal, allowTypes: opts.allowTypes, maxBytes: opts.maxBytes,
            });
            const mime = contentType || mimeFromName(a.urlPath) || 'application/octet-stream';
            return { bytes, mime, name: a.name, dataUrl: `data:${mime};base64,${bytes.toString('base64')}` };
        }
    }
    throw new Error(`첨부 '${a.id}' 에 데이터가 없습니다`);
}

export function mimeFromName(name: string): string {
    const ext = (name.split('.').pop() ?? '').toLowerCase();
    const table: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
        mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
        webm: 'video/webm', mp4: 'video/mp4',
    };
    return table[ext] ?? '';
}

export function kindFromMime(mime: string): OrchestratorAttachment['kind'] {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('text/') || mime.includes('pdf') || mime.includes('document') || mime.includes('sheet') || mime.includes('presentation')) return 'document';
    return 'other';
}

export function saveImage(buf: Buffer, alt: string, prefix = 'img'): TaskMedia {
    const { urlPath } = saveGeneratedFile(prefix, 'png', buf);
    return { kind: 'image', urlPath, markdown: `![${alt.slice(0, 80).replace(/[[\]]/g, '')}](${urlPath})` };
}

export function saveAudio(buf: Buffer, ext: string, label: string): TaskMedia {
    const { urlPath } = saveGeneratedFile('tts', ext, buf);
    return { kind: 'audio', urlPath, markdown: `[🔊 ${label}](${urlPath})` };
}

export function saveVideo(buf: Buffer, ext: string, label: string): TaskMedia {
    const { urlPath } = saveGeneratedFile('video', ext, buf);
    return { kind: 'video', urlPath, markdown: `[🎬 ${label}](${urlPath})` };
}

/** 매직 바이트로 오디오 확장자 판별 — 모르면 요청 형식 */
export function sniffAudioExt(buf: Buffer, fallback: string): string {
    if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return 'wav';
    if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS') return 'opus';
    if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'fLaC') return 'flac';
    if (buf.length >= 3 && (buf.toString('ascii', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0))) return 'mp3';
    return fallback;
}
