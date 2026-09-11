/**
 * @module services/orchestrator/executors/audio
 * @description audio.transcribe(STT, /v1/audio/transcriptions multipart) · audio.speech(TTS, /v1/audio/speech).
 * 공통 호출 경계(http-call) 사용. TTS 낭독 콘텐츠 = input.text → refs 본문 → 사용자 원문(instruction 은 읽지 않음).
 */
import { CAPABILITY_LIMITS, STT_ALLOWED_EXTS, TTS_ALLOWED_FORMATS, TTS_DEFAULT_FORMAT, TTS_DEFAULT_VOICE } from '../../../config/capabilities';
import { resolveCapabilityTarget } from '../capability-resolver';
import { callBinary, callJson } from '../http-call';
import { loadAttachment, saveAudio, sniffAudioExt } from '../media-io';
import { refsRawText, resolveTaskAttachments, type CapabilityExecutor } from '../types';

export const audioTranscribeExecutor: CapabilityExecutor = async (task, ctx) => {
    const [source] = resolveTaskAttachments(task, ctx, new Set(['audio', 'video']));
    if (!source) throw new Error('audio.transcribe: 오디오/영상 첨부(attachments 또는 refs)가 없습니다');
    const target = await resolveCapabilityTarget('audio.transcribe', ctx.userId);
    const input = await loadAttachment(source, {
        timeoutMs: CAPABILITY_LIMITS.STT_TIMEOUT_MS, signal: ctx.signal, maxBytes: CAPABILITY_LIMITS.STT_MAX_BYTES, allowTypes: ['audio/', 'video/'],
    });
    const ext = (input.name.split('.').pop() ?? '').toLowerCase();
    if (!STT_ALLOWED_EXTS.has(ext)) throw new Error(`허용되지 않는 오디오 형식: ${input.name}`);
    const fd = new FormData();
    fd.append('model', target.model);
    fd.append('file', new Blob([new Uint8Array(input.bytes)], { type: input.mime }), input.name);
    const language = String(task.extra.language ?? target.params.language ?? '');
    if (language) fd.append('language', language);
    const json = await callJson<{ text?: string }>(target, { body: fd, timeoutMs: CAPABILITY_LIMITS.STT_TIMEOUT_MS, signal: ctx.signal });
    const transcript = (json.text ?? '').trim();
    if (!transcript) throw new Error('전사 결과가 비어 있습니다');
    return { ok: true, text: transcript, media: [], model: target.fullId, usage: { units: { kind: 'audio_bytes', count: input.bytes.length } } };
};

export const audioSpeechExecutor: CapabilityExecutor = async (task, ctx) => {
    // 낭독 콘텐츠 = input.text(확정문) → refs 본문(라벨 없음) → 사용자 원문. instruction 은 지시일 뿐 읽지 않는다.
    const text = (task.text || refsRawText(task, ctx, CAPABILITY_LIMITS.TTS_MAX_CHARS) || (task.refs.length === 0 ? ctx.userMessage : '')).trim();
    if (!text) throw new Error('audio.speech: 합성할 텍스트가 없습니다 (input.text 또는 완료된 refs 필요)');
    if (text.length > CAPABILITY_LIMITS.TTS_MAX_CHARS) throw new Error(`텍스트가 너무 깁니다 (${text.length}자 > ${CAPABILITY_LIMITS.TTS_MAX_CHARS}자)`);
    const target = await resolveCapabilityTarget('audio.speech', ctx.userId);
    const requested = String(task.extra.format ?? target.params.format ?? '');
    const format = TTS_ALLOWED_FORMATS.has(requested) ? requested : TTS_DEFAULT_FORMAT;
    const voice = String(task.extra.voice || target.params.voice || TTS_DEFAULT_VOICE);
    const { bytes } = await callBinary(target, {
        body: { model: target.model, input: text, voice, response_format: format },
        timeoutMs: CAPABILITY_LIMITS.TTS_TIMEOUT_MS, signal: ctx.signal,
    });
    if (bytes.length === 0) throw new Error('음성 합성 응답이 비어 있습니다');
    const media = saveAudio(bytes, sniffAudioExt(bytes, format), ctx.lang === 'ko' ? '음성 듣기' : 'Listen');
    return { ok: true, text: ctx.lang === 'ko' ? `음성 합성 완료 (${text.length}자): ${media.urlPath}` : `Speech synthesized (${text.length} chars): ${media.urlPath}`, media: [media], model: target.fullId, usage: { units: { kind: 'chars', count: text.length } } };
};
