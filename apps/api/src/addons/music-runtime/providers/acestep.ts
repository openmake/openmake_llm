/**
 * music-runtime — ACE-Step 요청·응답 규칙 (P06). 종전 `executors/music.ts` 의 의미 그대로.
 *  - OpenRouter 호환 `/v1/chat/completions`(게이트웨이 pass-through) 1회 호출 — 생성 완료까지 응답을 잡는다(동기)
 *  - 길이·형식·가사 언어·연주곡 여부는 `audio_config`, 가사 본문은 최상위 `lyrics`
 *  - 산출물은 `message.audio[0].audio_url.url` 의 base64 data URL — 외부 URL 을 뒤따라가지 않는다
 * @module addons/music-runtime/providers/acestep
 */
import { MUSIC_GEN_DEFAULT_DURATION_SEC, MUSIC_GEN_DURATION_RANGE, MUSIC_GEN_FORMAT } from '../../../config/capabilities';

/** OpenRouter 호환 응답 — 오디오는 `message.audio[]`, 캡션·BPM 등 메타데이터는 `message.content` */
export interface AceChatResponse {
    choices?: Array<{ message?: { content?: string; audio?: Array<{ audio_url?: { url?: string } }> } }>;
}

/** 요청 길이(초) — 계획 인자 > 배정 params > 기본값, ACE-Step 허용 범위로 자른다 */
export function musicDuration(raw: unknown): number {
    const n = Number(raw);
    const v = Number.isFinite(n) && n > 0 ? n : MUSIC_GEN_DEFAULT_DURATION_SEC;
    return Math.min(MUSIC_GEN_DURATION_RANGE.max, Math.max(MUSIC_GEN_DURATION_RANGE.min, Math.round(v)));
}

export function decodeAudioDataUrl(url: string | undefined): Buffer | null {
    if (!url) return null;
    const m = /^data:(audio\/[\w.+-]+|application\/octet-stream);base64,(.+)$/s.exec(url.trim());
    if (!m) return null;
    const buf = Buffer.from(m[2], 'base64');
    return buf.length > 0 ? buf : null;
}

export function buildAceRequest(model: string, prompt: string, lyrics: string, duration: number, vocalLanguage: string | null): Record<string, unknown> {
    const audioConfig: Record<string, unknown> = { duration, format: MUSIC_GEN_FORMAT };
    if (lyrics) audioConfig.vocal_language = vocalLanguage ?? 'en';
    else audioConfig.instrumental = true;
    const body: Record<string, unknown> = { model, messages: [{ role: 'user', content: prompt }], modalities: ['audio', 'text'], audio_config: audioConfig };
    if (lyrics) body.lyrics = lyrics;
    return body;
}

export { MUSIC_GEN_FORMAT };
