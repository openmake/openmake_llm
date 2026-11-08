/**
 * 채팅 이미지 입력 유입 처리 — 이미지 입력 처리 보강(2026-11-08 점검).
 *
 * REST·WS·OpenAI 호환 경로가 모두 거치는 request-handler 에서 부른다. 주소 형태(http/https) 이미지는
 * 서버가 안전 fetch(downloadProviderUrl → safeFetch)로 받아 data URL 로 바꾸고, 그 밖의 스킴은 거부한다.
 * 이후 LLM 경계(utils/image-mime)에는 data URL·raw base64 만 도착한다.
 *
 * @module chat/inbound-images
 */
import { downloadProviderUrl } from '../services/orchestrator/http-call';
import { FILE_ATTACH_LIMITS } from '../config/runtime-limits';
import { createLogger } from '../utils/logger';

const log = createLogger('InboundImages');

const HTTP_URL_RE = /^https?:\/\//i;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** 사용자용 일반 문구만 담는다 — 주소·내부 사유는 메시지에 넣지 않는다 */
export class InboundImageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InboundImageError';
    }
}

function hostOf(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return '(invalid)';
    }
}

async function resolveOne(img: string): Promise<string> {
    if (img.startsWith('data:')) return img;
    if (HTTP_URL_RE.test(img)) {
        try {
            const { bytes, contentType } = await downloadProviderUrl(img, {
                timeoutMs: FILE_ATTACH_LIMITS.IMAGE_URL_FETCH_TIMEOUT_MS,
                allowTypes: ['image/'],
                // 변환 결과(base64 = 원본의 4/3)가 기존 dataURL 상한 안에 들도록
                maxBytes: Math.floor(FILE_ATTACH_LIMITS.MAX_IMAGE_DATAURL_CHARS * 3 / 4),
            });
            return `data:${contentType};base64,${bytes.toString('base64')}`;
        } catch (e) {
            // 오류 메시지에는 전체 주소가 들어 있을 수 있어 호스트명과 오류 종류만 남긴다
            const reason = (e as { kind?: string })?.kind ?? (e instanceof Error ? e.name : 'unknown');
            log.warn(`이미지 주소 가져오기 실패 host=${hostOf(img)} reason=${reason}`);
            throw new InboundImageError('이미지 주소를 가져올 수 없습니다');
        }
    }
    if (SCHEME_RE.test(img)) {
        log.warn(`지원하지 않는 이미지 주소 형식 거부 scheme=${img.slice(0, img.indexOf(':')).toLowerCase()}`);
        throw new InboundImageError('지원하지 않는 이미지 주소 형식입니다');
    }
    // 스킴 없음 → raw base64(기존 동작, buildImageDataUrl 이 MIME 추론)
    return img;
}

/** 요청 이미지 목록을 data URL·raw base64 로 정규화한다. 비었거나 전부 data/raw 면 fetch 없이 같은 내용 */
export async function resolveInboundImages(images: string[] | undefined): Promise<string[] | undefined> {
    if (!images || images.length === 0) return images;
    return Promise.all(images.map(resolveOne));
}

/** history 중 images 가 있는 항목만 새 객체로 바꾸고, 없는 항목은 같은 참조를 둔다 */
export async function resolveHistoryImages<T extends { images?: string[] }>(history: T[] | undefined): Promise<T[] | undefined> {
    if (!history) return history;
    return Promise.all(history.map(async (h) => {
        if (!h.images || h.images.length === 0) return h;
        return { ...h, images: await resolveInboundImages(h.images) };
    }));
}
