/**
 * ============================================================
 * Audio Tools — 음성 합성(TTS)·음성 인식(STT) 내장 도구
 * ============================================================
 *
 * 모델은 모달리티 배정(`tts`/`stt`, services/modality-resolver)으로 정하고, 호출은 LiteLLM
 * 게이트웨이의 OpenAI 호환 `/v1/audio/speech`·`/v1/audio/transcriptions` 하나로만 간다.
 * 노출은 상시가 아니라 의도 턴에만(config/modality MODALITY_TOOL_INTENT_GATES).
 *
 * @module mcp/audio-tools
 */
import { MCPToolDefinition, MCPToolResult } from './types';
import {
    MODALITY_LIMITS, TTS_ALLOWED_FORMATS, TTS_DEFAULT_FORMAT, TTS_DEFAULT_VOICE, STT_ALLOWED_EXTS,
} from '../config/modality';
import { resolveModalityTarget, ModalityUnavailableError } from '../services/modality-resolver';
import { withProviderSlot } from '../llm/external-throttle';
import { saveGeneratedFile, resolveGeneratedPath } from './generated-media';
import { safeFetch } from '../security/ssrf-guard';
import { createLogger } from '../utils/logger';
import * as fs from 'node:fs';

const logger = createLogger('AudioTools');

function textResult(text: string, isError = false): MCPToolResult {
    return { content: [{ type: 'text', text }], isError };
}

function userIdOf(context?: { userId?: string | number }): string | undefined {
    return context?.userId !== undefined ? String(context.userId) : undefined;
}

/** 매직 바이트로 오디오 확장자 판별 — 모르면 요청 형식 */
export function sniffAudioExt(buf: Buffer, fallback: string): string {
    if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return 'wav';
    if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS') return 'opus';
    if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'fLaC') return 'flac';
    if (buf.length >= 3 && (buf.toString('ascii', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0))) return 'mp3';
    return fallback;
}

function friendlyError(prefix: string, e: unknown): MCPToolResult {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`${prefix}: ${msg}`);
    const timeout = /timeout/i.test(msg);
    return textResult(timeout ? `${prefix} 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.` : `${prefix} 중 오류: ${msg}`, true);
}

export const textToSpeechTool: MCPToolDefinition = {
    tool: {
        name: 'text_to_speech',
        description:
            '텍스트를 음성 오디오 파일로 합성합니다(TTS). 사용자가 "읽어줘", "음성으로 만들어줘", "낭독" 등을 요청하면 사용하세요. ' +
            '결과로 받은 마크다운 링크를 답변에 그대로 포함하면 사용자가 재생할 수 있습니다.',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: `합성할 텍스트 (최대 ${MODALITY_LIMITS.TTS_MAX_CHARS}자)` },
                voice: { type: 'string', description: '목소리 이름 (provider 규격, 예: alloy). 생략 시 배정 기본값' },
                format: { type: 'string', description: '출력 형식 — mp3(기본) | wav | opus | aac | flac' },
            },
            required: ['text'],
        },
    },
    handler: async (args, context): Promise<MCPToolResult> => {
        const text = String(args.text || '').trim();
        if (!text) return textResult('text 가 필요합니다.', true);
        if (text.length > MODALITY_LIMITS.TTS_MAX_CHARS) {
            return textResult(`텍스트가 너무 깁니다 (${text.length}자 > ${MODALITY_LIMITS.TTS_MAX_CHARS}자). 나눠서 요청하세요.`, true);
        }
        let target;
        try {
            target = await resolveModalityTarget('tts', userIdOf(context));
        } catch (e) {
            if (e instanceof ModalityUnavailableError) return textResult(`음성 합성 불가: ${e.message}`, true);
            throw e;
        }
        const requestedFormat = String(args.format ?? target.params.format ?? '');
        const format = TTS_ALLOWED_FORMATS.has(requestedFormat) ? requestedFormat : TTS_DEFAULT_FORMAT;
        const voice = String(args.voice || target.params.voice || TTS_DEFAULT_VOICE);
        try {
            const res = await withProviderSlot(target.providerId, () => fetch(`${target.baseUrl}${target.endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...target.headers },
                body: JSON.stringify({ model: target.model, input: text, voice, response_format: format }),
                signal: AbortSignal.timeout(MODALITY_LIMITS.TTS_TIMEOUT_MS),
            }));
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                logger.warn(`TTS 실패: HTTP ${res.status} ${body.slice(0, 200)}`);
                return textResult(`음성 합성 실패 (HTTP ${res.status}). ${body.slice(0, 160)}`, true);
            }
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length === 0) return textResult('음성 합성 응답이 비어 있습니다.', true);
            // 실제 바이트로 확장자 확정 — provider 가 요청 형식과 다른 바이트/Content-Type 을 주는 경우가 있다
            const { filename, urlPath } = saveGeneratedFile('tts', sniffAudioExt(buf, format), buf);
            logger.info(`TTS 완료: ${filename} (${target.fullId}/${target.source}, ${text.length}자, ${buf.length}B)`);
            return textResult(`음성 파일이 생성되었습니다. 아래 링크를 답변에 그대로 포함하세요:\n\n[🔊 음성 듣기](${urlPath})`);
        } catch (e) {
            return friendlyError('음성 합성', e);
        }
    },
};

async function loadAudioInput(args: Record<string, unknown>): Promise<{ data: Buffer; filename: string } | string> {
    const base64 = typeof args.audio_base64 === 'string' ? args.audio_base64 : '';
    const url = typeof args.audio_url === 'string' ? args.audio_url.trim() : '';
    const filenameArg = typeof args.filename === 'string' ? args.filename : '';
    const extOf = (name: string) => (name.split('.').pop() || '').toLowerCase();

    if (base64) {
        const filename = filenameArg || 'audio.mp3';
        if (!STT_ALLOWED_EXTS.has(extOf(filename))) return `허용되지 않는 오디오 형식: ${filename}`;
        const data = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
        return { data, filename };
    }
    if (url.startsWith('/generated/')) {
        const abs = resolveGeneratedPath(url);
        if (!abs) return `찾을 수 없는 파일: ${url}`;
        const filename = url.split('/').pop() || 'audio.mp3';
        if (!STT_ALLOWED_EXTS.has(extOf(filename))) return `허용되지 않는 오디오 형식: ${filename}`;
        return { data: fs.readFileSync(abs), filename };
    }
    if (/^https?:\/\//i.test(url)) {
        const res = await safeFetch(url, { signal: AbortSignal.timeout(MODALITY_LIMITS.STT_TIMEOUT_MS) });
        if (!res.ok) return `오디오 다운로드 실패 (HTTP ${res.status})`;
        const filename = filenameArg || (new URL(url).pathname.split('/').pop() || 'audio.mp3');
        if (!STT_ALLOWED_EXTS.has(extOf(filename))) return `허용되지 않는 오디오 형식: ${filename}`;
        return { data: Buffer.from(await res.arrayBuffer()), filename };
    }
    return 'audio_url(https:// 또는 /generated/ 경로) 또는 audio_base64 가 필요합니다.';
}

export const transcribeAudioTool: MCPToolDefinition = {
    tool: {
        name: 'transcribe_audio',
        description:
            '오디오를 텍스트로 받아씁니다(STT). 사용자가 녹음·음성 파일의 전사/자막/텍스트 변환을 요청하면 사용하세요. ' +
            'audio_url 은 https:// 주소 또는 이 서비스가 생성한 /generated/ 경로, 또는 audio_base64 로 데이터를 직접 전달합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                audio_url: { type: 'string', description: '오디오 URL (https://…) 또는 /generated/<file>' },
                audio_base64: { type: 'string', description: '오디오 파일 base64 (audio_url 대신)' },
                filename: { type: 'string', description: '파일명(확장자로 형식 판별, base64/URL 확장자 없을 때)' },
                language: { type: 'string', description: 'ISO-639-1 언어 힌트 (예: ko). 생략 시 자동' },
            },
            required: [],
        },
    },
    handler: async (args, context): Promise<MCPToolResult> => {
        let target;
        try {
            target = await resolveModalityTarget('stt', userIdOf(context));
        } catch (e) {
            if (e instanceof ModalityUnavailableError) return textResult(`음성 인식 불가: ${e.message}`, true);
            throw e;
        }
        try {
            const loaded = await loadAudioInput(args);
            if (typeof loaded === 'string') return textResult(loaded, true);
            if (loaded.data.length > MODALITY_LIMITS.STT_MAX_BYTES) {
                return textResult(`오디오가 너무 큽니다 (${loaded.data.length}B > ${MODALITY_LIMITS.STT_MAX_BYTES}B).`, true);
            }
            const fd = new FormData();
            fd.append('model', target.model);
            fd.append('file', new Blob([new Uint8Array(loaded.data)]), loaded.filename);
            const language = String(args.language || target.params.language || '');
            if (language) fd.append('language', language);
            // multipart 는 Content-Type 을 fetch 가 boundary 와 함께 붙인다 — 수동 지정 금지
            const res = await withProviderSlot(target.providerId, () => fetch(`${target.baseUrl}${target.endpoint}`, {
                method: 'POST',
                headers: { ...target.headers },
                body: fd,
                signal: AbortSignal.timeout(MODALITY_LIMITS.STT_TIMEOUT_MS),
            }));
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                logger.warn(`STT 실패: HTTP ${res.status} ${body.slice(0, 200)}`);
                return textResult(`음성 인식 실패 (HTTP ${res.status}). ${body.slice(0, 160)}`, true);
            }
            const json = await res.json() as { text?: string };
            const transcript = (json.text ?? '').trim();
            if (!transcript) return textResult('음성 인식 결과가 비어 있습니다.', true);
            logger.info(`STT 완료: ${loaded.filename} → ${transcript.length}자 (${target.fullId}/${target.source})`);
            return textResult(`전사 결과:\n\n${transcript}`);
        } catch (e) {
            return friendlyError('음성 인식', e);
        }
    },
};

export const audioTools: MCPToolDefinition[] = [textToSpeechTool, transcribeAudioTool];
