/**
 * @module services/orchestrator/media-io
 * @description executor 공용 미디어 입출력 — 첨부(base64 / `/generated` 경로 / https) 로드, dataURL 변환, 결과 저장.
 */
import { saveGeneratedArtifact, scopedArtifactStore } from '../../runtime-ports/artifact-store';
import { resolveGeneratedPath } from '../../tools/generated-media';
import { downloadProviderUrl } from './http-call';
import { inferImageMime } from '../../utils/image-mime';
import { recordCost } from '../cost/cost-ledger-service';
import { COST_RATE_WILDCARD } from '../../config/cost-kinds';
import type { OrchestratorAttachment, TaskMedia } from './types';

/**
 * /generated 저장 바이트를 storage.generated 원장(kind, gb_day)에 계상(F25 kind 배선, S6).
 * 30일 TTL 보관 전체를 추적하는 배경 잡은 범위 밖이라 저장 시점에 "1 GB·일" 로 근사해 1회 기록한다.
 * 단가는 cost_rates(DB) → env STORAGE_GENERATED_USD_PER_GB_DAY → 0. userId 없으면(익명/시스템) 기록 생략.
 */
function recordGeneratedStorageCost(userId: string | undefined, bytes: number): void {
    if (!userId) return;
    recordCost({ userId, kind: 'storage.generated', unit: 'gb_day', rateKey: COST_RATE_WILDCARD, quantity: bytes / 1_000_000_000, costOwner: 'server', ctx: { feature: 'generated-media' } });
}

interface LoadedMedia { bytes: Buffer; mime: string; name: string; dataUrl: string }

interface LoadOptions {
    timeoutMs: number;
    signal?: AbortSignal;
    /** 바이트 상한 — 초과는 로드 전에(base64 길이·stat·content-length) 거부 */
    maxBytes: number;
    /** 허용 content-type 접두(https 다운로드 검증) */
    allowTypes: readonly string[];
    /** `/generated/<name>` 을 읽는 주체 — 소유자만 자기 산출물을 읽는다(P04). 없으면 게스트 공개분만 */
    userId?: string;
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
            // 소유권 판정을 지나는 읽기(P04) — 다른 사용자의 산출물·삭제본·격리본은 여기서 거절된다
            const loaded = await scopedArtifactStore({ userId: opts.userId }).read(a.urlPath, opts.maxBytes);
            const mime = a.mime || loaded.mime || mimeFromName(a.urlPath) || inferImageMime(loaded.bytes.toString('base64', 0, 64));
            return { bytes: loaded.bytes, mime, name: loaded.name, dataUrl: `data:${mime};base64,${loaded.bytes.toString('base64')}` };
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

/**
 * job 첨부에 이미 받아둔 결과가 실재하면 그 경로(P08, 종전 영상 전용 `savedVideoPath` 의 일반화) — capability 를 주면 그 job 만.
 * 사용자 소유 job(listRecent 가 user_id 로 조회)만 첨부에 실리고, 파일 전달은 artifact-store 가 다시 소유권을 본다.
 */
export function savedJobResultPath(att: OrchestratorAttachment | undefined, capability?: string): string | null {
    const p = att?.job?.resultPath;
    if (!p || (capability && att?.job?.capability !== capability)) return null;
    return resolveGeneratedPath(p) ? p : null;
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

/** 저장 scope — 소유자·대화·capability. 신규 파일은 전부 비공개 디렉토리 + 소유 레코드(P04) */
export interface SaveScope { userId?: string; sessionId?: string; capability?: string }

export async function saveImage(buf: Buffer, alt: string, prefix = 'img', scope: SaveScope | string = {}): Promise<TaskMedia> {
    const s = typeof scope === 'string' ? { userId: scope } : scope;
    const { urlPath } = await saveGeneratedArtifact(s, { kind: 'image', prefix, ext: 'png', bytes: buf, mime: 'image/png' });
    recordGeneratedStorageCost(s.userId, buf.length);
    return { kind: 'image', urlPath, markdown: `![${alt.slice(0, 80).replace(/[[\]]/g, '')}](${urlPath})` };
}

export async function saveAudio(buf: Buffer, ext: string, label: string, scope: SaveScope | string = {}): Promise<TaskMedia> {
    const s = typeof scope === 'string' ? { userId: scope } : scope;
    const { urlPath } = await saveGeneratedArtifact(s, { kind: 'audio', prefix: 'tts', ext, bytes: buf, mime: mimeFromName(`x.${ext}`) });
    recordGeneratedStorageCost(s.userId, buf.length);
    return { kind: 'audio', urlPath, markdown: `[🔊 ${label}](${urlPath})` };
}

export async function saveVideo(buf: Buffer, ext: string, label: string, scope: SaveScope | string = {}): Promise<TaskMedia> {
    const s = typeof scope === 'string' ? { userId: scope } : scope;
    const { urlPath } = await saveGeneratedArtifact(s, { kind: 'video', prefix: 'video', ext, bytes: buf, mime: mimeFromName(`x.${ext}`) });
    recordGeneratedStorageCost(s.userId, buf.length);
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
