/**
 * @module config/decision
 * @description 의사결정 어댑터(JEV-27B-VL, 서빙 이름 `jev-decision`) 호출 상수.
 *
 * 이 모델은 글을 쓰지 않는다 — 상태·질문·선택지를 주면 선택지 토큰의 logprob 을 돌려준다
 * (`/v1/completions`, max_tokens 1). 토큰 id·bias·온도는 어댑터에 딸려 오는 값이라 모델을 바꾸면 함께 바꿔야 한다
 * (출처: 어댑터의 `adapter_vllm/decision_head.json`, `calibration.json` — 2026-10-03 판).
 */
export const DECISION = {
    /** 게이트웨이(LiteLLM)에 등록된 모델 이름. DECISION_MODEL */
    MODEL: process.env.DECISION_MODEL || 'jev-decision',
    /** 판정 1건 상한 ms — 넘으면 판정 없음(fail-open). 실측 중앙값 670ms(Mac→게이트웨이→DGX). DECISION_TIMEOUT_MS */
    TIMEOUT_MS: parseInt(process.env.DECISION_TIMEOUT_MS || '3000', 10),
    /** [state] 에 싣는 본문 상한(자) — 판정에는 앞부분이면 충분하다. DECISION_STATE_MAX_CHARS */
    STATE_MAX_CHARS: parseInt(process.env.DECISION_STATE_MAX_CHARS || '1500', 10),
    /** 예/아니오(noul) 판독 — 선택지 토큰 id, 보정 bias, 온도 */
    NOUL: {
        FALSE_TOKEN_ID: 3721,
        TRUE_TOKEN_ID: 1802,
        FALSE_BIAS: 0.00011960109259234741,
        TRUE_BIAS: -0.00011981795250903815,
        TEMPERATURE: 1.0143134751376188,
    },
} as const;

/**
 * 미디어 게이트 — "이번 턴에 이미지·음악·영상 작업이 필요한가" 판정.
 * 지금은 **셰도우**(기록 전용)다: 판정은 `orchestrator_runs` 에 남길 뿐 Planner 호출 여부를 바꾸지 않는다.
 * Planner 결과와의 일치율을 실측한 뒤 Planner 생략에 쓸지 정한다.
 */
export const MEDIA_GATE = {
    /** 셰도우 판정 on/off. 결정 모델이 로컬 카탈로그에 없으면 켜져 있어도 호출하지 않는다. ORCHESTRATOR_GATE_SHADOW_ENABLED */
    SHADOW_ENABLED: process.env.ORCHESTRATOR_GATE_SHADOW_ENABLED !== 'false',
    /** 어댑터에 묻는 질문(영문 고정 — 어댑터 학습 형식) */
    QUESTION: 'Does the user want an image, music/audio, or video to be generated or edited in this turn?',
} as const;
