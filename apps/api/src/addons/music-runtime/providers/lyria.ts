/**
 * music-runtime — Gemini Lyria 요청·응답 규칙 (2026-10-02).
 *  - Gemini 네이티브 Interactions API 1회 호출: `POST /interactions` `{ model, input }` — 게이트웨이(OpenAI 호환)가 프록시하지
 *    못해 사용자/서버 키로 직결한다(`describeProviderSupport().direct`, `api: 'native'`)
 *  - 설명·가사·길이·연주곡 여부는 전부 `input` 한 문장에 적는다(전용 인자가 없다). 가사는 `[Verse]`·`[Chorus]` 구간 표시 그대로
 *  - 산출물은 `steps[].content[]` 의 `type: 'audio'` 블록(base64). 외부 URL 을 뒤따라가지 않는다
 * @module addons/music-runtime/providers/lyria
 */
import type { OperationSpec } from '../../../runtime-ports/model-invoker';

export const LYRIA_PROVIDER_ID = 'gemini';
export const LYRIA_ENDPOINT = '/interactions';
export const LYRIA_OPERATION = 'music.lyria.interactions';
export const LYRIA_OPERATIONS: Readonly<Record<string, OperationSpec>> = {
    [LYRIA_OPERATION]: { method: 'POST', path: LYRIA_ENDPOINT, body: 'json', response: 'json' },
};

/** 배정 가능한 Lyria 모델 — 실시간(웹소켓) 모델은 이 호출 방식이 아니다 */
const LYRIA_MODEL_PATTERN = /^lyria-(?!realtime)/;
/** 길이가 고정된 모델(30초 클립) — 길이를 적어도 따르지 않는다 */
const LYRIA_FIXED_LENGTH_PATTERN = /clip/;
const INSTRUMENTAL_NOTE = 'Instrumental only, no vocals.';

export function isLyriaModel(providerId: string, modelId: string): boolean {
    return providerId === LYRIA_PROVIDER_ID && LYRIA_MODEL_PATTERN.test(modelId);
}

/** durationSec — 사용자가 길이를 말했을 때만(null 이면 모델에 맡긴다) */
export function buildLyriaRequest(model: string, prompt: string, lyrics: string, durationSec: number | null): Record<string, unknown> {
    const parts = [prompt.trim()];
    if (durationSec && !LYRIA_FIXED_LENGTH_PATTERN.test(model)) parts.push(`Length: about ${durationSec} seconds.`);
    parts.push(lyrics ? `Lyrics:\n${lyrics}` : INSTRUMENTAL_NOTE);
    return { model, input: parts.join('\n\n') };
}

interface LyriaBlock { type?: string; data?: string; mime_type?: string; text?: string }
interface LyriaResponse { steps?: Array<{ content?: LyriaBlock[] }> }

function blocks(json: unknown): LyriaBlock[] {
    const steps = (json as LyriaResponse | null)?.steps;
    return Array.isArray(steps) ? steps.flatMap((s) => (Array.isArray(s?.content) ? s.content : [])) : [];
}

/** 마지막 오디오 블록 — 없으면 null */
export function extractLyriaAudio(json: unknown): { bytes: Buffer; mime: string } | null {
    const audio = blocks(json).filter((b) => b?.type === 'audio' && typeof b.data === 'string' && b.data).pop();
    if (!audio) return null;
    const bytes = Buffer.from(audio.data as string, 'base64');
    return bytes.length > 0 ? { bytes, mime: typeof audio.mime_type === 'string' ? audio.mime_type : '' } : null;
}

/** 오디오 없이 끝난 응답에서 모델이 남긴 글(거절 사유 등) */
export function extractLyriaText(json: unknown): string {
    return blocks(json).filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join(' ').trim();
}
