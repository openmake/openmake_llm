/**
 * 들어오는 첨부(사용자가 채널에 올린 이미지·문서)를 백엔드 요청 형태로 변환.
 * (나가는 방향 — 모델 생성 이미지·아티팩트를 Discord 첨부로 — 은 attachments.ts 담당)
 * - Discord CDN URL 은 서명·만료되므로 URL 을 넘기지 않고 봇이 직접 내려받아 base64 로 보낸다.
 * - 이미지(image/*) → 마지막 user 메시지의 image_url content part (data URI)
 * - 그 외 → OpenMake 확장 files[] 항목 (백엔드가 문서 텍스트를 추출)
 * - 상한 초과·내려받기 실패는 건너뛰고 파일명을 skipped 로 돌려준다.
 */
/// <reference types="node" />

/** 이 봇이 다루는 첨부 메타 — discord.js Attachment 와 구조 호환 */
export interface InboundAttachmentMeta {
    name: string;
    url: string;
    contentType: string | null;
    size: number;
}

export interface ImageUrlPart {
    type: 'image_url';
    image_url: { url: string };
}

export interface InboundFile {
    name: string;
    type?: string;
    size: number;
    data: string;
}

export interface InboundAttachments {
    imageParts: ImageUrlPart[];
    files: InboundFile[];
    /** 상한 초과 또는 내려받기 실패로 건너뛴 파일명 */
    skipped: string[];
}

export type InboundPayloadItem = { kind: 'image'; part: ImageUrlPart } | { kind: 'file'; file: InboundFile };

/** 상한 — 나가는 방향(attachments.ts)과 같은 수준이지만 방향이 달라 따로 둔다 */
export const INBOUND_LIMITS = {
    /** 첨부 1개 최대 바이트 */
    MAX_FILE_BYTES: 8 * 1024 * 1024,
    /** 메시지 전체 합계 최대 바이트 — 주의: base64 는 4/3 배라 합계 약 7.5MB 를 넘으면 백엔드 JSON 상한(10mb)에서 413 이 날 수 있다 */
    MAX_TOTAL_BYTES: 20 * 1024 * 1024,
    /** 메시지당 최대 개수 */
    MAX_COUNT: 10,
    /** 첨부 1개 내려받기 제한 시간 */
    DOWNLOAD_TIMEOUT_MS: 30_000,
};

/** 첨부만 있고 텍스트가 없을 때 보내는 기본 요청 문구 */
export const DEFAULT_ATTACHMENT_PROMPT = '첨부한 파일을 분석해 주세요.';

/** 선언 크기(size) 기준으로 개수·개별·합계 상한 안의 첨부만 고른다 (순서 유지) */
export function selectWithinLimits(metas: Iterable<InboundAttachmentMeta>): { accepted: InboundAttachmentMeta[]; skipped: string[] } {
    const accepted: InboundAttachmentMeta[] = [];
    const skipped: string[] = [];
    let total = 0;
    for (const m of metas) {
        if (accepted.length >= INBOUND_LIMITS.MAX_COUNT
            || m.size > INBOUND_LIMITS.MAX_FILE_BYTES
            || total + m.size > INBOUND_LIMITS.MAX_TOTAL_BYTES) {
            skipped.push(m.name);
            continue;
        }
        accepted.push(m);
        total += m.size;
    }
    return { accepted, skipped };
}

/** contentType 에서 파라미터(; charset=...)를 뗀 MIME */
function baseMime(contentType: string | null): string {
    return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

export function toImageDataUri(mime: string, data: Buffer): string {
    return `data:${mime};base64,${data.toString('base64')}`;
}

/** 내려받은 바이트를 이미지 part 또는 files 항목으로 분류 */
export function toPayloadItem(meta: InboundAttachmentMeta, data: Buffer): InboundPayloadItem {
    const mime = baseMime(meta.contentType);
    if (mime.startsWith('image/')) {
        return { kind: 'image', part: { type: 'image_url', image_url: { url: toImageDataUri(mime, data) } } };
    }
    return {
        kind: 'file',
        file: { name: meta.name, ...(mime ? { type: mime } : {}), size: data.length, data: data.toString('base64') },
    };
}

/** 답변 끝에 붙일 생략 안내 한 줄 (생략 없으면 빈 문자열) */
export function formatSkippedNotice(skipped: string[]): string {
    return skipped.length > 0 ? `⚠️ 첨부 생략(크기 초과 또는 내려받기 실패): ${skipped.join(', ')}` : '';
}

/** 첨부 1개 내려받기 — 실패·실제 크기 초과는 null */
async function download(meta: InboundAttachmentMeta): Promise<Buffer | null> {
    try {
        const res = await fetch(meta.url, { signal: AbortSignal.timeout(INBOUND_LIMITS.DOWNLOAD_TIMEOUT_MS) });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        return buf.length > INBOUND_LIMITS.MAX_FILE_BYTES ? null : buf;
    } catch (err) {
        console.warn(`[discord-bot] 첨부 내려받기 실패 (${meta.name}):`, err instanceof Error ? err.message : err);
        return null;
    }
}

/** 메시지 첨부를 내려받아 백엔드 요청 형태로 변환한다 */
export async function collectInboundAttachments(metas: Iterable<InboundAttachmentMeta>): Promise<InboundAttachments> {
    const { accepted, skipped } = selectWithinLimits(metas);
    const downloaded = await Promise.all(accepted.map(download));
    const result: InboundAttachments = { imageParts: [], files: [], skipped };
    accepted.forEach((meta, i) => {
        const data = downloaded[i];
        if (!data) {
            result.skipped.push(meta.name);
            return;
        }
        const item = toPayloadItem(meta, data);
        if (item.kind === 'image') result.imageParts.push(item.part);
        else result.files.push(item.file);
    });
    return result;
}
