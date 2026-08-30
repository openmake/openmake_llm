/**
 * 도구 이름 교정(P0-b) 설정.
 *
 * 모델이 존재하지 않는 도구 이름을 부르면 지금까지는 "도구를 찾을 수 없습니다: X" 만
 * 돌려줬다. 이름이 왜 틀렸는지(구분자·대소문자·다른 생태계 이름)를 알려주지 않으므로
 * 모델은 같은 이름을 다시 부르거나 엉뚱한 대안으로 새는 데 턴을 쓴다.
 *
 * 교정은 **결정적**이다 — 별칭 테이블(config/skill-compat.ts) + 문자열 거리만 쓰고
 * LLM 을 부르지 않는다(판단 경계 A형 금지).
 *
 * @module config/tool-name-suggest
 */
export const TOOL_NAME_SUGGEST = {
    /** 기능 게이트 — off 면 종전 오류 메시지 그대로. */
    enabled: process.env.TOOL_NAME_SUGGEST_ENABLED !== 'false',
    /** 오류 메시지에 붙일 최대 후보 수. */
    maxSuggestions: parseInt(process.env.TOOL_NAME_SUGGEST_MAX || '3', 10),
    /**
     * 편집거리 상한. 이름이 짧을수록 좁혀야 오탐이 없다 —
     * 실제 상한은 min(maxDistance, floor(len/3)) 이다.
     */
    maxDistance: parseInt(process.env.TOOL_NAME_SUGGEST_MAX_DISTANCE || '3', 10),
    /** 후보를 계산할 도구 목록 상한(비용 가드). */
    maxCandidates: parseInt(process.env.TOOL_NAME_SUGGEST_MAX_CANDIDATES || '400', 10),
    /**
     * 셸에서 도구 이름을 명령으로 실행했을 때(`sh: 1: web_search: not found`)
     * 결과 끝에 교정 안내를 덧붙인다.
     */
    shellHintEnabled: process.env.TOOL_NAME_SHELL_HINT_ENABLED !== 'false',
} as const;
