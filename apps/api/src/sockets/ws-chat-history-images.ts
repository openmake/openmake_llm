/**
 * WS 채팅 history 이미지 검증 — 멀티턴 vision(2026-11-08). WS 는 Zod 검증을 거치지 않으므로
 * REST 스키마와 같은 상한(항목별 개수·원소 길이, 요청 전체 = 현재 턴 + history 이미지 수)을 여기서 적용한다.
 *
 * @module sockets/ws-chat-history-images
 */
import { FILE_ATTACH_LIMITS } from '../config/runtime-limits';

type ImageLimits = Pick<typeof FILE_ATTACH_LIMITS, 'MAX_IMAGES' | 'MAX_IMAGE_DATAURL_CHARS'>;
export type HistoryImagesCheck = { ok: true } | { ok: false; message: string };

export function validateHistoryImages(history: unknown, currentCount: number, limits: ImageLimits = FILE_ATTACH_LIMITS): HistoryImagesCheck {
    if (!Array.isArray(history)) return { ok: true };
    const tooMany = { ok: false as const, message: `이미지는 최대 ${limits.MAX_IMAGES}개까지 첨부할 수 있습니다` };
    let total = currentCount;
    for (const item of history) {
        const images = (item as { images?: unknown } | null)?.images;
        if (images === undefined) continue;
        if (!Array.isArray(images)) return { ok: false, message: '이미지 형식이 올바르지 않습니다' };
        if (images.length > limits.MAX_IMAGES) return tooMany;
        for (const img of images) {
            if (typeof img !== 'string') return { ok: false, message: '이미지 형식이 올바르지 않습니다' };
            if (img.length > limits.MAX_IMAGE_DATAURL_CHARS) return { ok: false, message: '이미지 데이터가 너무 큽니다' };
        }
        total += images.length;
        if (total > limits.MAX_IMAGES) return tooMany;
    }
    return { ok: true };
}
