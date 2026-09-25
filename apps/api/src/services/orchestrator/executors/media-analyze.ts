/**
 * @module services/orchestrator/executors/media-analyze
 * @description audio.analyze / music.analyze / video.analyze — 배정 모델에 미디어를 네이티브 콘텐츠 파트로 싣고
 * 관찰 기록 텍스트를 받는다(전사 아님 — audio.transcribe 와 별개). vision.ts 의 패턴이지만 미디어 종류별 파트가 다르다:
 *   - audio(음악 포함) → `{ type:'input_audio', input_audio:{ data:<base64>, format } }`
 *   - video           → `{ type:'video_url', video_url:{ url:<dataUrl> } }`
 * 프레임 추출·트랜스코딩은 하지 않는다(ffmpeg 없음) — 원본 콘텐츠를 그대로 보낸다.
 * 역할(채팅) 모델을 바꿔치기하지 않으며 기록은 종합 단계의 근거로만 쓰인다.
 */
import {
    AUDIO_ANALYZE_DEFAULT_FORMAT, AUDIO_ANALYZE_FORMATS, CAPABILITY_LIMITS, ORCHESTRATOR,
} from '../../../config/capabilities';
import { buildExtraBody } from '../../../llm/reasoning-adapter';
import { resolveCapabilityTarget } from '../capability-resolver';
import { callJson, extractChatText, extractUsage } from '../http-call';
import { getMediaAnalyzeSystemPrompt } from '../../../prompts/svc-orchestrator-executors';
import { loadAttachment } from '../media-io';
import { refsText, resolveTaskAttachments, type CapabilityExecutor } from '../types';

export const mediaAnalyzeExecutor: CapabilityExecutor = async (task, ctx) => {
    const isVideo = task.capability === 'video.analyze';
    const [source] = resolveTaskAttachments(task, ctx, new Set([isVideo ? 'video' : 'audio']));
    if (!source) throw new Error(`${task.capability}: ${isVideo ? '영상' : '오디오'} 첨부(attachments 또는 refs)가 없습니다`);
    const target = ctx.targets?.get(task.id) ?? await resolveCapabilityTarget(task.capability, ctx.userId);

    const loaded = await loadAttachment(source, {
        timeoutMs: CAPABILITY_LIMITS.MEDIA_ANALYZE_TIMEOUT_MS,
        signal: ctx.signal,
        maxBytes: isVideo ? CAPABILITY_LIMITS.MEDIA_ANALYZE_VIDEO_MAX_BYTES : CAPABILITY_LIMITS.MEDIA_ANALYZE_AUDIO_MAX_BYTES,
        allowTypes: isVideo ? ['video/'] : ['audio/'],
        userId: ctx.userId,
    });

    // 머리글도 응답 언어로 — 영어 턴에 한국어 머리글이 섞이면 결과가 한국어로 뒤집힌다(text.ts 와 같은 이유).
    const ko = ctx.lang === 'ko';
    const refs = refsText(task, ctx, ORCHESTRATOR.RESULT_MAX_CHARS);
    const headerText = [
        task.instruction ? `${ko ? '## 지시' : '## Instruction'}\n${task.instruction}` : '',
        ctx.userMessage ? `${ko ? '## 사용자 원문' : '## User message'}\n${ctx.userMessage}` : '',
        refs ? `${ko ? '## 앞선 작업 결과' : '## Earlier task results'}\n${refs}` : '',
    ].filter(Boolean).join('\n\n') || (ko ? '첨부 미디어를 분석하세요.' : 'Analyze the attached media.');

    let mediaPart: Record<string, unknown>;
    if (isVideo) {
        mediaPart = { type: 'video_url', video_url: { url: loaded.dataUrl } };
    } else {
        const mimeKey = loaded.mime.split(';')[0].trim().toLowerCase();
        const format = AUDIO_ANALYZE_FORMATS[mimeKey] ?? AUDIO_ANALYZE_DEFAULT_FORMAT;
        mediaPart = { type: 'input_audio', input_audio: { data: loaded.bytes.toString('base64'), format } };
    }

    const body: Record<string, unknown> = {
        model: target.model,
        messages: [
            { role: 'system', content: getMediaAnalyzeSystemPrompt(task.capability, ctx.lang) },
            { role: 'user', content: [{ type: 'text', text: headerText }, mediaPart] },
        ],
        max_tokens: CAPABILITY_LIMITS.MEDIA_ANALYZE_MAX_TOKENS,
        stream: false,
    };
    // 로컬 모델은 thinking OFF(text.ts 와 동일) — 실제 라우팅된 모델 기준으로 판단한다.
    if (target.providerId === 'local-llm') Object.assign(body, buildExtraBody(false, target.model));

    const json = await callJson<unknown>(target, { body, timeoutMs: CAPABILITY_LIMITS.MEDIA_ANALYZE_TIMEOUT_MS, signal: ctx.signal });
    const text = extractChatText(json);
    if (!text) throw new Error('빈 응답');
    return { ok: true, text, media: [], model: target.fullId, usage: extractUsage(json) };
};
