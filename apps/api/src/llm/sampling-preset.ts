/**
 * 로컬 모델 샘플링 프리셋 적용 — thinking ON/OFF 에 맞는 공식 권장값을 채운다 (2026-09-03).
 *
 * 배경: 채팅 본선·에이전트 턴 등 대부분의 로컬 호출은 temperature 를 넘기지 않아 vLLM 의
 * `generation_config.json` 기본값(Qwen3.8: T 1.0 · top_p 0.95 — **추론 모드** 권장값)이 적용됐다.
 * 그런데 앱 기본은 thinking OFF 라, 공식 비추론 권장(T 0.7 · top_p 0.8 · presence 1.5)과 어긋났다.
 * 이 모듈은 LLMClient.chat 단일 지점에서 "호출자가 샘플링을 전혀 지정하지 않은" 로컬 요청에만
 * 모드별 프리셋을 채운다. 호출자가 temperature 를 하나라도 지정했으면(메타 호출 0.1~0.4 등) 손대지
 * 않고, 외부 provider 클라이언트(quotaExempt)는 건너뛴다 — 외부 모델은 각자 기본값이 맞다.
 *
 * @module llm/sampling-preset
 */
import { LOCAL_SAMPLING_PRESETS } from '../config/llm-parameters';
import { isThinkingEnabled } from './reasoning-adapter';
import type { ModelOptions, ThinkOption } from './types';

export interface SamplingPresetContext {
    /** 외부 provider 클라이언트(LLMConfig.quotaExempt) — 프리셋 미적용 */
    external?: boolean;
}

/** 호출자가 샘플링 파라미터를 하나라도 지정했는지 — 지정했으면 프리셋을 덮지 않는다 */
function hasCallerSampling(o: ModelOptions | undefined): boolean {
    return !!o && (
        o.temperature !== undefined || o.top_p !== undefined || o.top_k !== undefined
        || o.presence_penalty !== undefined || o.repeat_penalty !== undefined || o.min_p !== undefined
    );
}

/**
 * thinking 상태에 맞는 프리셋을 채운 options 를 돌려준다.
 * 게이트 OFF·외부 클라이언트·호출자 지정 샘플링이 있으면 입력 그대로.
 */
export function applyLocalSamplingPreset(
    options: ModelOptions | undefined,
    think: ThinkOption | undefined,
    ctx: SamplingPresetContext = {},
): ModelOptions | undefined {
    if (!LOCAL_SAMPLING_PRESETS.ENABLED || ctx.external || hasCallerSampling(options)) return options;
    const preset = isThinkingEnabled(think) ? LOCAL_SAMPLING_PRESETS.THINKING : LOCAL_SAMPLING_PRESETS.INSTRUCT;
    return { ...(options ?? {}), ...preset };
}
