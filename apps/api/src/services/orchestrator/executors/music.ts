/**
 * @module services/orchestrator/executors/music
 * @description music.generate — DGX ACE-Step 1.5 REST(`MUSIC_GEN_BASE_URL`, capability-resolver 의 음악 대상).
 *  - 제출(`/release_task`) → `/query_result` 폴링(MUSIC_WAIT_MS 상한) → 결과 `file`(`/v1/audio?path=…`)을 받아 /generated 저장
 *  - 결과 경로는 항상 음악 서버 base 에 다시 붙인다 — 응답이 준 호스트로는 요청하지 않는다
 *  - 상한 안에 안 끝나면 실패(영상과 달리 job 을 다음 턴으로 넘기지 않는다 — 생성 시간 실측 후 필요하면 도입)
 * 가사 = input.lyrics → input.text → refs 본문(앞 작업이 쓴 가사), 없으면 연주곡.
 */
import { detectLanguage } from '../../../chat/language-policy';
import {
    CAPABILITY_LIMITS, MUSIC_GEN_DEFAULT_DURATION_SEC, MUSIC_GEN_DURATION_RANGE, MUSIC_GEN_FORMAT,
    MUSIC_GEN_INSTRUMENTAL_LYRICS, MUSIC_GEN_QUERY_PATH, MUSIC_GEN_STATUS,
} from '../../../config/capabilities';
import { resolveCapabilityTarget } from '../capability-resolver';
import { callBinary, callJson } from '../http-call';
import { saveAudio, sniffAudioExt } from '../media-io';
import { refsRawText, type CapabilityExecutor } from '../types';
import { createLogger } from '../../../utils/logger';

const logger = createLogger('MusicExecutor');

interface AceTaskState { task_id?: string; status?: number; result?: string }
interface AceResultItem { file?: string; status?: number }

/** 요청 길이(초) — 계획 인자 > 배정 params > 기본값, ACE-Step 허용 범위로 자른다 */
export function musicDuration(raw: unknown): number {
    const n = Number(raw);
    const v = Number.isFinite(n) && n > 0 ? n : MUSIC_GEN_DEFAULT_DURATION_SEC;
    return Math.min(MUSIC_GEN_DURATION_RANGE.max, Math.max(MUSIC_GEN_DURATION_RANGE.min, Math.round(v)));
}

/** 결과 경로를 음악 서버 base 에 다시 붙인다 — 절대 URL 이 와도 경로·쿼리만 쓴다(내부 주소·다른 호스트로 가지 않게) */
export function musicFileUrl(baseUrl: string, file: string): string {
    const u = new URL(file, 'http://music.invalid');
    return `${baseUrl}${u.pathname}${u.search}`;
}

/** query_result 의 `result` 는 JSON 문자열(산출물 배열) — 첫 산출물만 쓴다(batch_size 1) */
function firstResult(state: AceTaskState): AceResultItem | undefined {
    if (!state.result) return undefined;
    try {
        const parsed = JSON.parse(state.result) as unknown;
        return (Array.isArray(parsed) ? parsed[0] : parsed) as AceResultItem | undefined;
    } catch {
        return undefined;
    }
}

/** abort 시 즉시 reject, 정상 종료 시 리스너 정리 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) { reject(new Error('취소됨')); return; }
        const onAbort = () => { clearTimeout(t); reject(new Error('취소됨')); };
        const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
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

    const body: Record<string, unknown> = {
        model: target.model, prompt, lyrics: lyrics || MUSIC_GEN_INSTRUMENTAL_LYRICS,
        audio_duration: duration, audio_format: MUSIC_GEN_FORMAT, batch_size: 1,
    };
    if (lyrics) body.vocal_language = detectLanguage(lyrics).language;
    const submitted = await callJson<{ data?: { task_id?: string } }>(target, {
        body, timeoutMs: CAPABILITY_LIMITS.MUSIC_REQUEST_TIMEOUT_MS, signal: ctx.signal,
    });
    const taskId = submitted.data?.task_id;
    if (!taskId) throw new Error(`음악 생성 응답에 작업 id 가 없습니다 ${JSON.stringify(submitted).slice(0, 160)}`);
    logger.info(`[Music] 제출 ${taskId} (${target.fullId}, ${duration}s${lyrics ? '' : ', instrumental'})`);

    const deadline = Date.now() + CAPABILITY_LIMITS.MUSIC_WAIT_MS;
    let state: AceTaskState | undefined;
    for (;;) {
        await sleep(Math.min(CAPABILITY_LIMITS.MUSIC_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())), ctx.signal);
        const res = await callJson<{ data?: AceTaskState[] }>(target, {
            url: `${target.baseUrl}${MUSIC_GEN_QUERY_PATH}`, body: { task_id_list: [taskId] },
            timeoutMs: CAPABILITY_LIMITS.MUSIC_REQUEST_TIMEOUT_MS, signal: ctx.signal,
        });
        state = res.data?.find((s) => s.task_id === taskId);
        if (state?.status === MUSIC_GEN_STATUS.succeeded || state?.status === MUSIC_GEN_STATUS.failed) break;
        if (Date.now() >= deadline) throw new Error(`음악 생성이 ${Math.round(CAPABILITY_LIMITS.MUSIC_WAIT_MS / 1000)}초 안에 끝나지 않았습니다 (작업 ${taskId})`);
    }

    const item = firstResult(state);
    if (state.status !== MUSIC_GEN_STATUS.succeeded || item?.status === MUSIC_GEN_STATUS.failed || !item?.file) {
        throw new Error(`음악 생성 실패 (작업 ${taskId}) ${String(state.result ?? '').slice(0, 160)}`);
    }
    const { bytes, contentType } = await callBinary(target, {
        method: 'GET', url: musicFileUrl(target.baseUrl, item.file),
        timeoutMs: CAPABILITY_LIMITS.MUSIC_DOWNLOAD_TIMEOUT_MS, signal: ctx.signal,
    });
    if (!contentType.startsWith('audio/') && contentType !== 'application/octet-stream') throw new Error(`음악 파일 형식이 아닙니다 (${contentType || '형식 없음'})`);
    if (bytes.length === 0) throw new Error('음악 파일이 비어 있습니다');
    const media = saveAudio(bytes, sniffAudioExt(bytes, MUSIC_GEN_FORMAT), ko ? '음악 듣기' : 'Listen', ctx.userId);
    const kind = lyrics ? '' : (ko ? ', 연주곡' : ', instrumental');
    return {
        ok: true, media: [media], model: target.fullId,
        text: ko ? `음악 생성 완료 (${duration}초${kind}): ${media.urlPath}` : `Music generated (${duration}s${kind}): ${media.urlPath}`,
    };
};
