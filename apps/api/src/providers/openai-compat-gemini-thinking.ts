/**
 * Google 직접 provider(`gemini`) 사고 요약 — 요청 조립 + 스트림 가르개 (2026-11-15).
 *
 * 배경: provider id `gemini` 는 추론 관련 필드를 하나도 보내지 않아, Thinking 토글을 켜도 Google 이 사고 요약을
 * 응답에 싣지 않았다(`onThinking` 0). 실측(2026-11-15, 2.5-flash·3-flash-preview):
 *   - 직접: `extra_body:{google:{thinking_config:{include_thoughts:true}}}` → 200. 사고는 `delta.content` 맨 앞의
 *     `<thought>…</thought>` 로 온다(답의 첫 조각이 `</thought>` 로 시작).
 *   - 게이트웨이(LiteLLM `gemini/*` → `openai/*`): `extra_body` 를 한 겹 풀어 올려 같은 본문은 400("Unknown name "google"")
 *     → 한 겹 더 감싸야 200. 사고 표시(`extra_content.google.thought`)는 LiteLLM 이 지운다 → 태그로만 가른다.
 *   - `reasoning_effort` 와 `thinking_config` 를 함께 보내면 두 경로 모두 400 — 강도는 보내지 않는다(모델 기본 사고량).
 *   - 사고 미지원 모델(flash-lite)도 200 이고 태그가 없다.
 *
 * 순수 함수·클래스 — provider 인스턴스 없이 테스트 가능.
 * @module providers/openai-compat-gemini-thinking
 */
import type { ReasoningEffort } from '../config/reasoning-effort';

/** Google 직접 provider id */
const GOOGLE_DIRECT_PROVIDER_ID = 'gemini';
/** Google OpenAI 호환 응답의 사고 구간 태그 */
const THOUGHT_OPEN_TAG = '<thought>';
const THOUGHT_CLOSE_TAG = '</thought>';

/** IProvider ChatOptions.thinking 과 동일 형태 */
type ProviderThinkingOption = boolean | ReasoningEffort | { budget: number };

type GoogleThoughtsBody = { google: { thinking_config: { include_thoughts: true } } };

/** 사고 요약 요청 필드 — `gemini` + thinking 켬일 때만, 그 밖엔 빈 객체(기존 요청과 동일) */
export function buildGeminiThinkingParams(
    providerId: string,
    thinking: ProviderThinkingOption | undefined,
    viaGateway: boolean,
): { extra_body?: GoogleThoughtsBody | { extra_body: GoogleThoughtsBody } } {
    if (!wantsGeminiThoughts(providerId, thinking)) return {};
    const body: GoogleThoughtsBody = { google: { thinking_config: { include_thoughts: true } } };
    return { extra_body: viaGateway ? { extra_body: body } : body };
}

/** 사고 요약을 요청하는 호출인가 — 스트림 가르개 적용 여부도 이것으로 정한다 */
export function wantsGeminiThoughts(providerId: string, thinking: ProviderThinkingOption | undefined): boolean {
    return providerId === GOOGLE_DIRECT_PROVIDER_ID && thinking !== undefined && thinking !== false;
}

export interface ThoughtSplit {
    thinking: string;
    content: string;
}

/** buf 의 꼬리가 tag 의 (전체가 아닌) 접두와 일치하는 최대 길이 */
function partialSuffixLength(buf: string, tag: string): number {
    for (let n = Math.min(buf.length, tag.length - 1); n > 0; n--) {
        if (tag.startsWith(buf.slice(buf.length - n))) return n;
    }
    return 0;
}

/**
 * `content` 맨 앞의 `<thought>…</thought>` 구간(닫힌 직후 바로 다시 열리는 연속 구간 포함)을 사고로 가른다.
 * 본문이 시작된 뒤의 `<thought>` 는 글자 그대로 본문이다. 태그가 조각 경계에서 잘리면 접두를 붙들었다 판정한다.
 */
export class GeminiThoughtSplitter {
    /** expectOpen: 맨 앞 또는 닫힌 직후(여는 태그 대기) · thought: 사고 안 · body: 본문(그대로 통과) */
    private state: 'expectOpen' | 'thought' | 'body' = 'expectOpen';
    private buf = '';

    feed(delta: string): ThoughtSplit {
        if (this.state === 'body') return { thinking: '', content: delta };
        this.buf += delta;
        let thinking = '';
        let content = '';
        for (;;) {
            if (this.state === 'expectOpen') {
                if (this.buf.startsWith(THOUGHT_OPEN_TAG)) {
                    this.buf = this.buf.slice(THOUGHT_OPEN_TAG.length);
                    this.state = 'thought';
                    continue;
                }
                if (THOUGHT_OPEN_TAG.startsWith(this.buf)) break; // 미완 접두(빈 값 포함) — 붙든다
                this.state = 'body';
                content = this.buf;
                this.buf = '';
                break;
            }
            // thought
            const closeIdx = this.buf.indexOf(THOUGHT_CLOSE_TAG);
            if (closeIdx >= 0) {
                thinking += this.buf.slice(0, closeIdx);
                this.buf = this.buf.slice(closeIdx + THOUGHT_CLOSE_TAG.length);
                this.state = 'expectOpen';
                continue;
            }
            const held = partialSuffixLength(this.buf, THOUGHT_CLOSE_TAG);
            thinking += this.buf.slice(0, this.buf.length - held);
            this.buf = this.buf.slice(this.buf.length - held);
            break;
        }
        return { thinking, content };
    }

    /** 스트림 끝 — 사고 안이면 남은 것은 사고(닫힘 없이 끝), 여는 태그 미완 접두는 본문 */
    flush(): ThoughtSplit {
        const rest = this.buf;
        this.buf = '';
        return this.state === 'thought' ? { thinking: rest, content: '' } : { thinking: '', content: rest };
    }
}
