/**
 * @module services/chat-service/vision-bridge
 * @description 역할(채팅) 모델이 비전을 지원하지 않을 때 모달리티 `vision` 모델이 첨부 이미지를
 * 텍스트 관찰 기록으로 옮겨 넘긴다 — 역할 모델을 바꿔치기하지 않는다(컨텍스트·prefix cache 유지).
 *
 * 호출은 LiteLLM 게이트웨이 `/v1/chat/completions` 하나(로컬 alias·외부 `<provider>/<model>` 공통),
 * provider 세마포어(withProviderSlot) 공유. `vision` 미배정이면 null 을 돌려 호출부가 종전 400 을 낸다
 * (조용한 폴백 금지 — 배정하면 동작이 바뀐다는 것을 로그로 남긴다).
 */
import { MODALITY_LIMITS } from '../../config/modality';
import { resolveModalityTarget, ModalityUnavailableError } from '../modality-resolver';
import { withProviderSlot } from '../../llm/external-throttle';
import { getVisionBridgeSystemPrompt, getVisionBridgeNote } from '../../prompts/vision-bridge';
import { inferImageMime } from '../../utils/image-mime';
import { createLogger } from '../../utils/logger';
import type { ChatMessageRequest } from '../chat-service-types';

const logger = createLogger('VisionBridge');

/**
 * 브리지 결과를 요청·컨텍스트에 반영한다(순수). external-messages 는 user 턴 본문을
 * `ctx.enhancedMessage || req.message` 로 고르므로 **둘 다** 에 기록을 덧붙여야 한다 — 라이브에서
 * req.message 만 바꿔 기록이 통째로 누락됐다(2026-09-12). 현재 턴 이미지는 제거, history 이미지도 제거.
 */
export function applyVisionBridge<C extends { enhancedMessage?: string }>(
    req: ChatMessageRequest,
    ctx: C,
    note: string,
): { req: ChatMessageRequest; ctx: C } {
    const stripHistory = (req.history ?? []).map((h) => (h.images ? { ...h, images: undefined } : h));
    const base = ctx.enhancedMessage || req.message || '';
    return {
        req: { ...req, images: undefined, message: `${req.message ?? ''}\n\n${note}`, history: stripHistory },
        ctx: { ...ctx, enhancedMessage: `${base}\n\n${note}` },
    };
}

export interface VisionBridgeResult {
    /** 역할 모델의 user 메시지 끝에 덧붙일 블록(헤더 + 관찰 기록) */
    note: string;
    fullId: string;
    imageCount: number;
    skipped: number;
}

export interface VisionBridgeInput {
    images: string[];
    userMessage: string;
    userId?: string;
    lang: string;
    /** 테스트 주입용 */
    fetchImpl?: typeof fetch;
}

function toDataUrl(img: string): string {
    return img.startsWith('data:') ? img : `data:${inferImageMime(img)};base64,${img}`;
}

/**
 * 첨부 이미지를 vision 모델로 설명한다. vision 미배정이면 null(호출부가 종전 동작).
 * 호출 실패는 throw — 호출부가 사용자에게 사유를 보이게 한다(이미지를 조용히 버리지 않는다).
 */
export async function describeImagesForTextModel(input: VisionBridgeInput): Promise<VisionBridgeResult | null> {
    let target;
    try {
        target = await resolveModalityTarget('vision', input.userId);
    } catch (err) {
        if (err instanceof ModalityUnavailableError && err.code === 'MODALITY_UNASSIGNED') {
            logger.info('[VisionBridge] vision 모달리티 미배정 — 브리지 생략(종전 400 유지)');
            return null;
        }
        throw err;
    }

    const max = MODALITY_LIMITS.VISION_BRIDGE_MAX_IMAGES;
    const images = input.images.slice(0, max);
    const skipped = input.images.length - images.length;
    const content: Array<Record<string, unknown>> = [
        { type: 'text', text: input.userMessage ? `사용자 질문(초점 참고용): ${input.userMessage.slice(0, 500)}` : '첨부 이미지를 서술하세요.' },
        ...images.map((img) => ({ type: 'image_url', image_url: { url: toDataUrl(img), ...(target.params.detail ? { detail: target.params.detail } : {}) } })),
    ];
    const body = {
        model: target.model,
        messages: [
            { role: 'system', content: getVisionBridgeSystemPrompt(input.lang) },
            { role: 'user', content },
        ],
        max_tokens: MODALITY_LIMITS.VISION_BRIDGE_MAX_TOKENS,
        stream: false,
    };
    const doFetch = input.fetchImpl ?? fetch;
    const startedAt = Date.now();
    const res = await withProviderSlot(target.providerId, () => doFetch(`${target.baseUrl}${target.endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...target.headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(MODALITY_LIMITS.VISION_BRIDGE_TIMEOUT_MS),
    }));
    if (!res.ok) {
        const text = (await res.text().catch(() => '')).slice(0, 200);
        throw new Error(`vision 모델(${target.fullId}) 호출 실패: HTTP ${res.status} ${text}`);
    }
    const json = await res.json() as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
    const raw = json.choices?.[0]?.message?.content;
    const text = (typeof raw === 'string' ? raw : (raw ?? []).map((b) => b.text ?? '').join('')).trim();
    if (!text) throw new Error(`vision 모델(${target.fullId}) 응답이 비어 있습니다`);

    logger.info(`[VisionBridge] ${images.length}장 → ${text.length}자 (${target.fullId}/${target.source}, ${Date.now() - startedAt}ms${skipped ? `, 초과 ${skipped}장 생략` : ''})`);
    const skippedNote = skipped > 0
        ? (input.lang === 'ko' ? `\n(첨부 ${input.images.length}장 중 ${max}장만 기록 — 상한 초과 ${skipped}장 생략)` : `\n(${max} of ${input.images.length} images recorded — ${skipped} skipped over the limit)`)
        : '';
    return {
        note: `${getVisionBridgeNote(input.lang, target.fullId)}\n${text}${skippedNote}`,
        fullId: target.fullId,
        imageCount: images.length,
        skipped,
    };
}
