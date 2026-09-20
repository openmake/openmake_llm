/**
 * 모델 프로필 실측 프로브 (오픈웨이트 전환 S2) — 프로필에는 **실측값만** 적는다는 규칙의 측정 도구.
 *
 * 앱의 provider 어댑터를 거치지 않고 OpenAI 호환 `/chat/completions` 를 **그대로** 부른다 — 어댑터는 프로필을 읽어
 * reasoning 강도를 정규화하므로(config/reasoning-effort) 그 경로로 재면 "프로필에 적힌 대로 나온다" 는 순환이 된다.
 * 판정은 PURE(`judgeProbe`)이고 전송은 주입받는다. 확정하지 못한 항목은 프로필에 넣지 않고 notes 로만 남긴다.
 *
 * @module evaluation/model-probe
 */
import { REASONING_EFFORT_LADDER, type ModelProfile, type ReasoningEffort } from '../config/model-profiles';

export interface ProbeHttpResult {
    status: number;
    /** 파싱된 JSON 본문(비스트리밍) — 실패·비JSON 이면 null */
    body: Record<string, unknown> | null;
    /** 스트리밍 요청에서 받은 SSE data 줄 수 */
    sseChunks?: number;
    /** 전송 오류(타임아웃·연결 실패) */
    error?: string;
}

export type ProbePost = (payload: Record<string, unknown>) => Promise<ProbeHttpResult>;

export interface ProbeObservations {
    basic: ProbeHttpResult;
    stream: ProbeHttpResult;
    tools: ProbeHttpResult;
    vision: ProbeHttpResult;
    efforts: Partial<Record<ReasoningEffort, ProbeHttpResult>>;
}

/** 도구 프로브의 함수 이름·비전 프로브의 정답 — 판정과 요청이 같은 값을 본다 */
export const PROBE_TOOL_NAME = 'get_weather';
const PROBE_MAX_TOKENS = 256;

function message(r: ProbeHttpResult): Record<string, unknown> | null {
    const choices = r.body?.choices;
    if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') return null;
    const m = (choices[0] as Record<string, unknown>).message;
    return m && typeof m === 'object' ? m as Record<string, unknown> : null;
}

const ok = (r: ProbeHttpResult): boolean => r.status >= 200 && r.status < 300 && !r.error;
/** 요청 자체를 거절한 4xx — 인증(401/403)·한도(429)·없는 모델(404)은 능력 판정 근거가 아니다 */
const rejected = (r: ProbeHttpResult): boolean => r.status === 400 || r.status === 422;

/** 오류 본문의 메시지 — provider 마다 `error.message`·`error`(문자열)·`message` 로 다르다 */
function errorMessage(r: ProbeHttpResult): string {
    const e = r.body?.error;
    const msg = typeof e === 'string' ? e : (e as { message?: unknown } | undefined)?.message ?? r.body?.message;
    return typeof msg === 'string' ? msg.slice(0, 200) : '';
}

function hasReasoning(r: ProbeHttpResult): boolean {
    const m = message(r);
    if (!m) return false;
    return [m.reasoning_content, m.reasoning].some((v) => typeof v === 'string' && v.trim().length > 0);
}

export interface ProbeVerdict {
    /** `LLM_MODEL_PROFILES_JSON` 에 그대로 넣을 수 있는 조각 — 확정한 필드만 */
    profile: ModelProfile;
    /** 필드별 판정 근거·미확정 사유 */
    notes: string[];
    /** 기본 호출조차 실패 — 나머지 판정은 의미가 없다 */
    unreachable: boolean;
}

export function judgeProbe(o: ProbeObservations, visionAnswer: string): ProbeVerdict {
    const notes: string[] = [];
    if (!ok(o.basic)) {
        const why = o.basic.error ?? errorMessage(o.basic);
        return { profile: {}, unreachable: true, notes: [`기본 호출 실패 — status ${o.basic.status}${why ? ` (${why})` : ''}. 키·모델 id·한도부터 확인`] };
    }

    const verdicts: Record<'toolCalling' | 'thinking' | 'vision' | 'streaming', boolean | null> = {
        toolCalling: null, thinking: null, vision: null, streaming: null,
    };

    // streaming
    if (ok(o.stream) && (o.stream.sseChunks ?? 0) > 0) verdicts.streaming = true;
    else if (rejected(o.stream)) verdicts.streaming = false;
    else notes.push(`streaming 미확정 — status ${o.stream.status}, SSE ${o.stream.sseChunks ?? 0}줄`);

    // toolCalling — 도구를 실제로 불렀을 때만 true. 200 인데 안 부른 것은 "못 한다" 의 증거가 아니다
    const toolCalls = message(o.tools)?.tool_calls;
    if (ok(o.tools) && Array.isArray(toolCalls) && toolCalls.some((c) => (c as { function?: { name?: string } })?.function?.name === PROBE_TOOL_NAME)) verdicts.toolCalling = true;
    else if (rejected(o.tools)) { verdicts.toolCalling = false; notes.push('toolCalling=false — 도구 정의가 있는 요청을 4xx 로 거절'); }
    else notes.push(`toolCalling 미확정 — status ${o.tools.status}, tool_calls 없음(모델이 본문으로 답했을 수 있다)`);

    // vision — 정답을 맞혔을 때만 true. 이미지를 조용히 버리고 200 을 주는 서버가 있다
    const visionText = String(message(o.vision)?.content ?? '');
    if (ok(o.vision) && visionText.includes(visionAnswer)) verdicts.vision = true;
    else if (rejected(o.vision)) { verdicts.vision = false; notes.push('vision=false — 이미지가 있는 요청을 4xx 로 거절'); }
    else notes.push(`vision 미확정 — status ${o.vision.status}, 답 "${visionText.slice(0, 40)}"(정답 ${visionAnswer})`);

    // reasoning 강도 — 200 은 수락, 400/422 는 거절. 그 밖(429·5xx)은 미확정이라 목록을 확정하지 않는다
    const effortResults = REASONING_EFFORT_LADDER.map((e) => ({ effort: e, r: o.efforts[e] }));
    const accepted = effortResults.filter((x) => x.r && ok(x.r)).map((x) => x.effort);
    const undecided = effortResults.filter((x) => !x.r || (!ok(x.r) && !rejected(x.r))).map((x) => x.effort);

    // thinking — 앱 기준의 능력은 "추론을 별도 필드로 받을 수 있는가" 다. 한 번이라도 나오면 true,
    // 강도 요청이 전부 결판났는데(수락이든 거절이든) 한 번도 안 나왔으면 false — 그 0/N 관측이 실측값이다.
    // (추론을 하지 않는 모델도 reasoning_effort 를 받고 무시한다 — hasa qwen2.5-vl 실측 2026-09-20. 수락은 증거가 아니다)
    const answered = [o.basic, ...effortResults.map((x) => x.r).filter((r): r is ProbeHttpResult => !!r && ok(r))];
    if (answered.some(hasReasoning)) verdicts.thinking = true;
    else if (undecided.length === 0) { verdicts.thinking = false; notes.push(`thinking=false — 응답 ${answered.length}건에서 추론 필드 0건(강도 수락 ${accepted.length}·거절 ${effortResults.length - accepted.length})`); }
    else notes.push('thinking 미확정 — 추론 필드가 없는데 강도 요청 일부가 결판나지 않았다(429·5xx)');

    const profile: ModelProfile = {};
    // 추론은 하는데 강도를 전부 거절 — 모델이 아니라 중간 계층(게이트웨이)이 파라미터를 막았을 수 있다. 조용히 빈 목록으로 두지 않는다
    if (undecided.length === 0 && accepted.length === 0 && verdicts.thinking === true) {
        const why = effortResults[0]?.r ? errorMessage(effortResults[0].r) : '';
        notes.push(`reasoningEfforts 미확정 — 추론 모델인데 강도를 전부 거절${why ? `: ${why}` : ''}`);
    }
    if (undecided.length > 0) notes.push(`reasoningEfforts 미확정 — ${undecided.join(', ')} 의 응답이 수락/거절로 갈리지 않음`);
    else if (accepted.length > 0 && verdicts.thinking === true) {
        profile.reasoningEfforts = accepted;
        const refused = effortResults.filter((x) => x.r && rejected(x.r)).map((x) => x.effort);
        if (refused.length) notes.push(`reasoning_effort 거절: ${refused.join(', ')}`);
    }

    // capabilities 는 네 값이 전부 확정일 때만 — 프로필 항목은 네 필드를 함께 요구한다(parseProfile)
    const { toolCalling, thinking, vision, streaming } = verdicts;
    if (toolCalling !== null && thinking !== null && vision !== null && streaming !== null) {
        profile.capabilities = { toolCalling, thinking, vision, streaming };
    } else {
        const open = Object.entries(verdicts).filter(([, v]) => v === null).map(([k]) => k);
        notes.push(`capabilities 는 프로필에 넣지 않음 — 미확정 ${open.join(', ')} (확정: ${Object.entries(verdicts).filter(([, v]) => v !== null).map(([k, v]) => `${k}=${v}`).join(', ') || '없음'})`);
    }
    return { profile, notes, unreachable: false };
}

/**
 * 프로브 실행 — **순차**(운영 vLLM 은 새 요청 여러 개가 한 스텝에 prefill 될 때 죽은 선례가 있다, 2026-09-19).
 * 기본 호출이 실패하면 나머지는 보내지 않는다(한도·키 문제에 요청을 더 태우지 않는다).
 */
export async function runProbe(
    post: ProbePost, model: string, imageBase64: string, visionQuestion: string,
    /** 강도 요청에만 얹는 필드 — LiteLLM 게이트웨이는 `allowed_openai_params` 힌트 없이는 파라미터 자체를 400 으로 막는다 */
    effortExtra: Record<string, unknown> = {},
    /** 요청 사이 간격(ms) — 무료 티어는 연속 호출을 429 로 막는다(hasa 실측 2026-09-20) */
    delayMs = 0,
): Promise<ProbeObservations> {
    const rawPost = post;
    let first = true;
    post = async (payload) => {
        if (!first && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        first = false;
        return rawPost(payload);
    };
    const user = (content: unknown) => [{ role: 'user', content }];
    const base = { model, max_tokens: PROBE_MAX_TOKENS };
    const skipped: ProbeHttpResult = { status: 0, body: null, error: 'skipped' };

    const basic = await post({ ...base, messages: user('Reply with the single word OK.') });
    if (!ok(basic)) return { basic, stream: skipped, tools: skipped, vision: skipped, efforts: {} };

    const stream = await post({ ...base, stream: true, messages: user('Reply with the single word OK.') });
    const tools = await post({
        ...base, messages: user('What is the weather in Seoul right now? Use the tool.'), tool_choice: 'auto',
        tools: [{ type: 'function', function: { name: PROBE_TOOL_NAME, description: 'Get current weather for a city', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } }],
    });
    const vision = await post({
        ...base,
        messages: user([{ type: 'text', text: visionQuestion }, { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }]),
    });
    const efforts: ProbeObservations['efforts'] = {};
    for (const effort of REASONING_EFFORT_LADDER) {
        efforts[effort] = await post({ ...base, ...effortExtra, reasoning_effort: effort, messages: user('What is 17 * 23? Answer with the number only.') });
    }
    return { basic, stream, tools, vision, efforts };
}
