/**
 * 절차 스킬(skill_save / skill_run) 설정 — 이름 매칭 임계와 저장 전 평문 비밀 값 검사 패턴.
 * 기능 on/off 와 제안 개수는 AGENT_TASK_LIMITS(PROCEDURAL_SKILLS_ENABLED, PROCEDURAL_MAX_SUGGEST)에 있다.
 *
 * @module config/procedural-skill
 */
const num = (v: string | undefined, d: number): number => {
    const n = Number(v);
    return v !== undefined && Number.isFinite(n) ? n : d;
};

export const PROCEDURAL_SKILL = {
    /** 이름 매칭·제안 후보로 읽는 본인 절차 스킬 최대 수. AGENT_TASK_PROCEDURAL_SEARCH_LIMIT */
    SEARCH_LIMIT: num(process.env.AGENT_TASK_PROCEDURAL_SEARCH_LIMIT, 50),
    /** 이름·목표에 질의가 부분 일치할 때의 점수. */
    FUZZY_CONTAINS_SCORE: num(process.env.AGENT_TASK_PROCEDURAL_FUZZY_CONTAINS_SCORE, 0.5),
    /** 이름 매칭으로 인정하는 최소 점수. AGENT_TASK_PROCEDURAL_FUZZY_MIN_SCORE */
    FUZZY_MIN_SCORE: num(process.env.AGENT_TASK_PROCEDURAL_FUZZY_MIN_SCORE, 0.3),
    /** 형태 변형 매칭(square↔squaring)에 쓰는 공유 접두 글자 수. */
    STEM_PREFIX_CHARS: num(process.env.AGENT_TASK_PROCEDURAL_STEM_PREFIX_CHARS, 5),
    /** 설명·이름 저장 길이 상한. */
    DESCRIPTION_MAX_CHARS: 500,
    NAME_MAX_CHARS: 120,
} as const;

/** 비밀 값을 받는 입력란 — 브라우저 액션의 selector·label·name 에 이 패턴이 있으면 입력값은 {{param}} 이어야 한다. */
export const PROCEDURAL_SECRET_FIELD_RE = new RegExp(
    process.env.AGENT_TASK_PROCEDURAL_SECRET_FIELD_PATTERN
        || 'passw(or)?d|passwd|\\bpwd\\b|secret|token|\\botp\\b|api[_ -]?key|credential|비밀번호|암호|인증번호|보안코드',
    'i',
);

/** 스크립트 본문에 박힌 비밀 값 — 환경 변수 참조($VAR)와 {{param}} 은 걸리지 않게 리터럴 값만 본다. */
export const PROCEDURAL_SECRET_VALUE_RES: readonly RegExp[] = (process.env.AGENT_TASK_PROCEDURAL_SECRET_VALUE_PATTERNS
    ? process.env.AGENT_TASK_PROCEDURAL_SECRET_VALUE_PATTERNS.split('|||')
    : [
        'bearer\\s+[a-z0-9._-]{16,}',
        '\\bsk-[a-z0-9_-]{16,}',
        'omk_live_[a-z0-9]{8,}',
        '(?:passw(?:or)?d|passwd|secret|token|api[_-]?key)["\']?\\s*[=:]\\s*["\']?[^\\s"\'${}]{6,}',
    ]).map((p) => new RegExp(p, 'i'));
