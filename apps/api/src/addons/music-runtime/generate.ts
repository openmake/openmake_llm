/**
 * music-runtime — music.generate handler (Base·Add-on 통합 P06, 2026-09-23).
 * 종전 `services/orchestrator/executors/music.ts` 의 의미(가사 우선순위·길이·응답 파싱·저장) 그대로. 차이는 호출 경계뿐 —
 * provider 호출은 `ctx.model`(pass-through 연산), 저장은 `ctx.artifacts`. 받는 모델은 `describeProviderSupport` 로 선언한다 —
 * 로컬 음악 서버(ACE-Step)와 Gemini 의 Lyria(네이티브 API 직결, providers/lyria). 그 밖의 외부 모델은 배정·실행 모두 거절한다.
 * @module addons/music-runtime/generate
 */
import { detectLanguage } from '../../chat/language-policy';
import { CAPABILITY_LIMITS, PLAN_CONVERSATION_TEXT_MARKER } from '../../config/capabilities';
import type { CapabilityContext, CapabilityHandler } from '../../capability-contract/types';
import { refsRawText, type TaskMedia } from '../../services/orchestrator/types';
import { sniffAudioExt } from '../../services/orchestrator/media-io';
import type { PlanTask } from '../../services/orchestrator/plan-schema';
import { createLogger } from '../../utils/logger';
import { buildAceRequest, decodeAudioDataUrl, musicDuration, MUSIC_GEN_FORMAT, type AceChatResponse } from './providers/acestep';
import { buildLyriaRequest, extractLyriaAudio, extractLyriaText, isLyriaModel, LYRIA_ENDPOINT, LYRIA_OPERATION, LYRIA_OPERATIONS } from './providers/lyria';
import { normalizeMusicPlanInput } from './plan-input';
import { conversationLyrics, extractLyrics } from './lyrics-source';

const logger = createLogger('MusicRuntime');

/**
 * 부를 가사 — 계획 인자(lyrics·text) → 앞 작업 결과(refs) → 대화(사용자 메시지·최근 답변).
 * 대화는 계획이 PLAN_CONVERSATION_TEXT_MARKER 를 적었을 때, 또는 가사·참조가 모두 비었는데 사용자 메시지 자체가 가사일 때
 * (Planner 가 표시를 빠뜨린 경우 — 가사를 붙여 넣고 연주곡을 바랄 리 없다) 찾는다.
 */
function resolveLyrics(task: PlanTask, ctx: CapabilityContext): string {
    const planned = String(task.extra.lyrics || task.text || refsRawText(task, ctx, CAPABILITY_LIMITS.MUSIC_LYRICS_MAX_CHARS) || '').trim();
    const marked = planned === PLAN_CONVERSATION_TEXT_MARKER;
    if (!marked && (planned || task.refs.length > 0 || !extractLyrics(ctx.userMessage))) return planned;
    const found = conversationLyrics(ctx.userMessage, ctx.recentAssistantMessages);
    if (!found) throw new Error('music.generate: 대화에서 가사를 찾지 못했습니다 — [Verse]·[Chorus] 같은 구간 표시가 2개 이상 있는 가사를 보내 주세요');
    logger.info(`[Music] ${task.id} 가사를 대화에서 사용 (${found.source}, ${found.lyrics.length}자${marked ? '' : ', 계획 표시 없음'})`);
    return found.lyrics;
}

/** `provider:model` 의 model 부분 */
function modelIdOf(fullId: string): string {
    return fullId.slice(fullId.indexOf(':') + 1);
}

/** Lyria — 설명·가사·길이를 한 문장으로 보내고 응답의 오디오 블록을 저장한다 */
async function executeLyria(task: PlanTask, ctx: CapabilityContext, prompt: string, lyrics: string): Promise<{ bytes: Buffer; mime: string; duration: number | null }> {
    const target = ctx.model.describe();
    // 길이는 사용자가 말했을 때만 적는다 — 말하지 않으면 모델이 곡에 맞게 정한다(ACE-Step 의 기본 30초를 강요하지 않는다)
    const asked = task.extra.duration || target.params.duration;
    const duration = asked ? musicDuration(asked) : null;
    logger.info(`[Music] 요청 (${target.fullId}${duration ? `, ${duration}s` : ''}${lyrics ? '' : ', instrumental'})`);
    const res = await ctx.model.invokeJson<unknown>({
        operation: LYRIA_OPERATION, payload: buildLyriaRequest(target.model, prompt, lyrics, duration),
        timeoutMs: CAPABILITY_LIMITS.MUSIC_WAIT_MS, signal: ctx.signal,
    });
    const audio = extractLyriaAudio(res);
    if (!audio) {
        const hint = extractLyriaText(res).slice(0, 160);
        // 응답 규격은 문서로만 확인했다(2026-10-02: 무료 등급 키로는 Lyria 가 429 라 실측 불가) — 규격이 다르면 여기서 구조가 보이게 남긴다
        logger.warn(`[Music] ${target.fullId} 응답에 오디오 블록이 없음 — 최상위 키: ${Object.keys((res ?? {}) as object).join(',') || '(없음)'}`);
        throw new Error(`음악 생성 응답에 오디오가 없습니다${hint ? ` — ${hint}` : ''}`);
    }
    return { ...audio, duration };
}

export const musicGenerateHandler: CapabilityHandler = {
    operations: LYRIA_OPERATIONS,
    describeProviderSupport(model) {
        if (!model.isExternal) return { supported: true };
        return isLyriaModel(model.providerId, modelIdOf(model.fullId))
            ? { supported: true, direct: { endpoint: LYRIA_ENDPOINT, api: 'native' } }
            : { supported: false, reason: `음악 생성은 로컬 음악 서버(ACE-Step)와 Gemini 의 Lyria 모델만 지원합니다 — '${model.fullId}' 는 배정할 수 없습니다` };
    },
    normalizePlanInput: normalizeMusicPlanInput,
    async execute(task: PlanTask, ctx: CapabilityContext) {
        const target = ctx.model.describe();
        const lyria = isLyriaModel(target.providerId, target.model);
        if (target.providerId !== 'local-llm' && !lyria) throw new Error(`music.generate: 외부 provider(${target.providerId}) 음악 생성은 지원하지 않습니다 — 로컬 음악 서버와 Gemini Lyria 만 가능`);
        const ko = ctx.lang === 'ko';
        const prompt = (task.instruction || ctx.userMessage).trim();
        if (!prompt) throw new Error('music.generate: instruction(음악 설명)이 비어 있습니다');
        const lyrics = resolveLyrics(task, ctx);
        if (lyrics.length > CAPABILITY_LIMITS.MUSIC_LYRICS_MAX_CHARS) throw new Error(`가사가 너무 깁니다 (${lyrics.length}자 > ${CAPABILITY_LIMITS.MUSIC_LYRICS_MAX_CHARS}자)`);
        if (lyria) {
            const out = await executeLyria(task, ctx, prompt, lyrics);
            const ext = sniffAudioExt(out.bytes, out.mime.includes('wav') ? 'wav' : MUSIC_GEN_FORMAT);
            const ref = await ctx.artifacts.save({ kind: 'audio', prefix: 'tts', ext, bytes: out.bytes, mime: `audio/${ext === 'mp3' ? 'mpeg' : ext}` });
            const media: TaskMedia = { kind: 'audio', urlPath: ref.urlPath, markdown: `[🔊 ${ko ? '음악 듣기' : 'Listen'}](${ref.urlPath})` };
            const notes = [out.duration ? (ko ? `${out.duration}초 요청` : `${out.duration}s requested`) : '', lyrics ? '' : (ko ? '연주곡' : 'instrumental')].filter(Boolean).join(', ');
            return {
                ok: true, media: [media], model: target.fullId,
                text: ko ? `음악 생성 완료${notes ? ` (${notes})` : ''}: ${media.urlPath}` : `Music generated${notes ? ` (${notes})` : ''}: ${media.urlPath}`,
            };
        }
        const duration = musicDuration(task.extra.duration || target.params.duration);
        const body = buildAceRequest(target.model, prompt, lyrics, duration, lyrics ? detectLanguage(lyrics).language : null);

        logger.info(`[Music] 요청 (${target.fullId}, ${duration}s${lyrics ? '' : ', instrumental'})`);
        const res = await ctx.model.invokeJson<AceChatResponse>({ operation: 'music.chat_completions', payload: body, timeoutMs: CAPABILITY_LIMITS.MUSIC_WAIT_MS, signal: ctx.signal });
        const message = res.choices?.[0]?.message;
        const bytes = decodeAudioDataUrl(message?.audio?.[0]?.audio_url?.url);
        if (!bytes) {
            const hint = (message?.content ?? '').trim().slice(0, 160);
            throw new Error(`음악 생성 응답에 오디오가 없습니다${hint ? ` — ${hint}` : ''}`);
        }
        const ext = sniffAudioExt(bytes, MUSIC_GEN_FORMAT);
        const ref = await ctx.artifacts.save({ kind: 'audio', prefix: 'tts', ext, bytes, mime: `audio/${ext === 'mp3' ? 'mpeg' : ext}` });
        const media: TaskMedia = { kind: 'audio', urlPath: ref.urlPath, markdown: `[🔊 ${ko ? '음악 듣기' : 'Listen'}](${ref.urlPath})` };
        const kind = lyrics ? '' : (ko ? ', 연주곡' : ', instrumental');
        return {
            ok: true, media: [media], model: target.fullId,
            text: ko ? `음악 생성 완료 (${duration}초${kind}): ${media.urlPath}` : `Music generated (${duration}s${kind}): ${media.urlPath}`,
        };
    },
};
