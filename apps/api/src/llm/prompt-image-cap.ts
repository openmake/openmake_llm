/**
 * 로컬 vLLM 요청당 프롬프트 이미지 총량 캡 (2026-09-03).
 *
 * vLLM 은 `--limit-mm-per-prompt '{"image": N}'` 를 넘는 요청을 400
 * ("At most N image(s) may be provided in one prompt") 으로 거절한다. 앱은 현재 턴 첨부만
 * `FILE_ATTACH_LIMITS.MAX_IMAGES`(20) 로 막고 history 이미지는 합산하지 않아, 한 요청의
 * 총량이 N 을 넘는 경로가 열려 있었다(라이브 재현: 8장 정상 · 9장 400). 에이전트 작업은
 * goal 메시지가 절단 앵커로 고정 보존되므로 초과 시 매 턴 400 이 반복된다.
 *
 * 이 모듈은 LLMClient(로컬 전용) 의 wire 변환 직전 단일 지점에서 총량을 캡에 맞춘다 —
 * 가장 오래된 메시지의 이미지부터 제외하고 최신 메시지의 이미지를 최대한 보존한다.
 * 외부 provider 는 OpenAICompatProvider 가 별도 경로라 영향 없음.
 *
 * @module llm/prompt-image-cap
 */
import type { ChatMessage } from './types';
import { createLogger } from '../utils/logger';

const log = createLogger('PromptImageCap');

/** wire 변환이 이미지를 싣는 역할 — toOpenAIMessages 와 동일 조건 유지 */
function carriesImages(m: ChatMessage): boolean {
    return (m.role === 'user' || m.role === 'system') && Array.isArray(m.images) && m.images.length > 0;
}

export interface PromptImageCapResult {
    messages: ChatMessage[];
    /** 요청 전체 이미지 수 (캡 적용 전) */
    total: number;
    /** 제외된 이미지 수 (0 이면 입력 그대로 반환) */
    dropped: number;
}

/**
 * 요청 전체 이미지 수가 `cap` 을 넘으면 오래된 메시지부터 이미지를 제외한다.
 * `cap <= 0` 이면 비활성(입력 그대로). 입력 배열·메시지 객체는 변경하지 않는다.
 */
export function capPromptImages(messages: ChatMessage[], cap: number): PromptImageCapResult {
    let total = 0;
    for (const m of messages) if (carriesImages(m)) total += m.images!.length;
    if (cap <= 0 || total <= cap) return { messages, total, dropped: 0 };

    let toDrop = total - cap;
    const out = messages.map((m) => {
        if (toDrop <= 0 || !carriesImages(m)) return m;
        const imgs = m.images!;
        const take = Math.max(0, imgs.length - toDrop);
        toDrop -= imgs.length - take;
        const rest = { ...m };
        delete rest.images;
        // 메시지 안에서도 앞쪽(오래된) 이미지부터 제외 — 마지막 첨부를 우선 보존
        return take > 0 ? { ...rest, images: imgs.slice(imgs.length - take) } : rest;
    });
    const dropped = total - cap;
    log.warn(`요청 이미지 ${total}장 → 상한 ${cap}장 적용 (오래된 ${dropped}장 제외)`);
    return { messages: out, total, dropped };
}
