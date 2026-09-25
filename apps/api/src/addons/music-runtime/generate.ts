/**
 * music-runtime — music.generate handler (Base·Add-on 통합 P06, 2026-09-23).
 * 종전 `services/orchestrator/executors/music.ts` 의 의미(가사 우선순위·길이·응답 파싱·저장) 그대로. 차이는 호출 경계뿐 —
 * provider 호출은 `ctx.model`(pass-through 연산), 저장은 `ctx.artifacts`. 로컬 전용 제약은 `describeProviderSupport` 로 선언한다(정책 확대 없음).
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

export const musicGenerateHandler: CapabilityHandler = {
    describeProviderSupport(model) {
        return model.isExternal
            ? { supported: false, reason: `음악 생성은 로컬 음악 서버(ACE-Step)만 지원합니다 — '${model.fullId}' 는 배정할 수 없습니다` }
            : { supported: true };
    },
    normalizePlanInput: normalizeMusicPlanInput,
    async execute(task: PlanTask, ctx: CapabilityContext) {
        const target = ctx.model.describe();
        if (target.providerId !== 'local-llm') throw new Error(`music.generate: 외부 provider(${target.providerId}) 음악 생성은 지원하지 않습니다 — 로컬 음악 서버만 가능`);
        const ko = ctx.lang === 'ko';
        const prompt = (task.instruction || ctx.userMessage).trim();
        if (!prompt) throw new Error('music.generate: instruction(음악 설명)이 비어 있습니다');
        const lyrics = resolveLyrics(task, ctx);
        if (lyrics.length > CAPABILITY_LIMITS.MUSIC_LYRICS_MAX_CHARS) throw new Error(`가사가 너무 깁니다 (${lyrics.length}자 > ${CAPABILITY_LIMITS.MUSIC_LYRICS_MAX_CHARS}자)`);
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
