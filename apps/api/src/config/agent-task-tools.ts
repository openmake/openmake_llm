/**
 * Agent Task 도구·실행 환경·완료 판정 보강 설정 (hermes-agent 검토 2단계, 2026-10-04).
 *
 * 문자열 치환의 단계적 매칭, 종료 코드 해석, 검색 무일치 원인 안내, 편집 후 문법 검사,
 * 검증 증거 원장, 파일 변경 실패 각주, 구조화 질문의 스위치와 임계값을 둔다.
 * 문구는 prompts/agent-task-tools.ts 에 있다.
 *
 * @module config/agent-task-tools
 */
const num = (v: string | undefined, d: number): number => {
    const n = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(n) ? n : d;
};

/**
 * str_replace 단계적 매칭 — 정확 일치가 0건일 때 줄 끝 공백 → 들여쓰기 → 따옴표 종류 순으로 차이를 무시하고
 * 다시 찾는다. 어느 단계든 **한 곳에만** 맞을 때 적용하고, 여러 곳에 맞으면 적용하지 않는다.
 * AGENT_TASK_STR_REPLACE_FUZZY=false 로 끄면 종전처럼 정확 일치만 한다(비슷한 줄 안내는 남는다).
 */
export const STR_REPLACE_MATCH = {
    FUZZY_ENABLED: process.env.AGENT_TASK_STR_REPLACE_FUZZY !== 'false',
    /** 실패 안내에 싣는 "비슷한 줄" 최대 개수. */
    CLOSEST_MAX_LINES: num(process.env.AGENT_TASK_STR_REPLACE_CLOSEST_MAX_LINES, 3),
    /** 비슷하다고 보는 최소 유사도(0~1, 글자 2-gram 겹침). 낮추면 무관한 줄이 섞인다. */
    CLOSEST_MIN_SIMILARITY: num(process.env.AGENT_TASK_STR_REPLACE_CLOSEST_MIN_SIMILARITY, 0.5),
    /** 안내에 싣는 한 줄의 최대 글자 수. */
    CLOSEST_LINE_MAX_CHARS: 200,
    /** 여러 곳에 맞았을 때 안내에 싣는 줄 번호 최대 개수. */
    AMBIGUOUS_MAX_LINES: 5,
} as const;

/** 같은 문자로 보는 따옴표 — 값(ASCII)으로 바꿔 비교한다. 글자 수가 그대로라 위치가 어긋나지 않는다. */
export const QUOTE_EQUIVALENTS: Readonly<Record<string, string>> = {
    '‘': "'", '’': "'", '“': "'", '”': "'", '"': "'",
};
