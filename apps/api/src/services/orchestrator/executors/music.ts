/**
 * @module services/orchestrator/executors/music
 * @description music.generate — DGX ACE-Step 1.5 의 OpenRouter 호환 `/v1/chat/completions`(LiteLLM 경유).
 *  - 호출 1회로 끝난다: ACE-Step 이 생성 완료까지 응답을 잡고(동기) 산출물을 base64 data URL 로 실어 준다
 *    (종전 `/release_task` → `/query_result` 폴링 → 파일 내려받기 3단계는 2026-09-23 제거)
 *  - 길이·형식·가사 언어·연주곡 여부는 `audio_config`, 가사 본문은 최상위 `lyrics`
 *  - 대기 상한(MUSIC_WAIT_MS)을 넘으면 실패 — 영상과 달리 job 을 다음 턴으로 넘기지 않는다
 * 가사 = input.lyrics → input.text → refs 본문(앞 작업이 쓴 가사), 없으면 연주곡.
 */
import { detectLanguage } from '../../../chat/language-policy';
import {
    CAPABILITY_LIMITS, MUSIC_GEN_DEFAULT_DURATION_SEC, MUSIC_GEN_DURATION_RANGE, MUSIC_GEN_FORMAT,
} from '../../../config/capabilities';
import { resolveCapabilityTarget } from '../capability-resolver';
import { callJson } from '../http-call';
import { saveAudio, sniffAudioExt } from '../media-io';
import { refsRawText, type CapabilityExecutor } from '../types';
import { createLogger } from '../../../utils/logger';

const logger = createLogger('MusicExecutor');

/** OpenRouter 호환 응답 — 오디오는 `message.audio[]`, 캡션·BPM 등 메타데이터는 `message.content` */
interface AceChatResponse {
    choices?: Array<{
        message?: {
            content?: string;
            audio?: Array<{ audio_url?: { url?: string } }>;
        };
    }>;
}

/** 요청 길이(초) — 계획 인자 > 배정 params > 기본값, ACE-Step 허용 범위로 자른다 */
export function musicDuration(raw: unknown): number {
    const n = Number(raw);
    const v = Number.isFinite(n) && n > 0 ? n : MUSIC_GEN_DEFAULT_DURATION_SEC;
    return Math.min(MUSIC_GEN_DURATION_RANGE.max, Math.max(MUSIC_GEN_DURATION_RANGE.min, Math.round(v)));
}

/**
 * base64 data URL(`data:audio/mpeg;base64,…`)에서 바이트를 꺼낸다.
 * data URL 이 아니거나 오디오가 아니면 null — 호출부가 명시 실패로 돌린다(외부 URL 을 뒤따라가지 않는다).
 */
export function decodeAudioDataUrl(url: string | undefined): Buffer | null {
    if (!url) return null;
    const m = /^data:(audio\/[\w.+-]+|application\/octet-stream);base64,(.+)$/s.exec(url.trim());
    if (!m) return null;
    const buf = Buffer.from(m[2], 'base64');
    return buf.length > 0 ? buf : null;
}

export const musicGenerateExecutor: CapabilityExecutor = async (task, ctx) => {
    const target = ctx.targets?.get(task.id) ?? await resolveCapabilityTarget('music.generate', ctx.userId);
    if (target.providerId !== 'local-llm') throw new Error(`music.generate: 외부 provider(${target.providerId}) 음악 생성은 지원하지 않습니다 — 로컬 음악 서버만 가능`);
    const ko = ctx.lang === 'ko';
    const prompt = (task.instruction || ctx.userMessage).trim();
    if (!prompt) throw new Error('music.generate: instruction(음악 설명)이 비어 있습니다');
    const lyrics = String(task.extra.lyrics || task.text || refsRawText(task, ctx, CAPABILITY_LIMITS.MUSIC_LYRICS_MAX_CHARS) || '').trim();
    if (lyrics.length > CAPABILITY_LIMITS.MUSIC_LYRICS_MAX_CHARS) throw new Error(`가사가 너무 깁니다 (${lyrics.length}자 > ${CAPABILITY_LIMITS.MUSIC_LYRICS_MAX_CHARS}자)`);
    const duration = musicDuration(task.extra.duration || target.params.duration);

    const audioConfig: Record<string, unknown> = { duration, format: MUSIC_GEN_FORMAT };
    if (lyrics) audioConfig.vocal_language = detectLanguage(lyrics).language;
    else audioConfig.instrumental = true;
    const body: Record<string, unknown> = {
        model: target.model,
        messages: [{ role: 'user', content: prompt }],
        modalities: ['audio', 'text'],
        audio_config: audioConfig,
    };
    if (lyrics) body.lyrics = lyrics;

    logger.info(`[Music] 요청 (${target.fullId}, ${duration}s${lyrics ? '' : ', instrumental'})`);
    const res = await callJson<AceChatResponse>(target, {
        body, timeoutMs: CAPABILITY_LIMITS.MUSIC_WAIT_MS, signal: ctx.signal,
    });

    const message = res.choices?.[0]?.message;
    const bytes = decodeAudioDataUrl(message?.audio?.[0]?.audio_url?.url);
    if (!bytes) {
        const hint = (message?.content ?? '').trim().slice(0, 160);
        throw new Error(`음악 생성 응답에 오디오가 없습니다${hint ? ` — ${hint}` : ''}`);
    }
    const media = await saveAudio(bytes, sniffAudioExt(bytes, MUSIC_GEN_FORMAT), ko ? '음악 듣기' : 'Listen', { userId: ctx.userId, sessionId: ctx.sessionId, capability: 'music.generate' });
    const kind = lyrics ? '' : (ko ? ', 연주곡' : ', instrumental');
    return {
        ok: true, media: [media], model: target.fullId,
        text: ko ? `음악 생성 완료 (${duration}초${kind}): ${media.urlPath}` : `Music generated (${duration}s${kind}): ${media.urlPath}`,
    };
};
