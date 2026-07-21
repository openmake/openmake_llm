/**
 * 자동 기억형성(#3 b) 설정 — 패턴·임계값·프롬프트 외부화(no-hardcoding).
 * ① 휴리스틱(무-LLM): 명시적 저장 의도 문장. ② LLM 추출: 대화당 1콜(vLLM 부하).
 * 둘 다 기본 OFF. 추출된 메모리는 즉시 active(자동 주입) — 사용자는 삭제로만 제거.
 *
 * @module config/memory-extraction
 */
export const MEMORY_EXTRACTION = {
    /** 휴리스틱(무-LLM) 추출 활성 — vLLM 부하 0. USER_MEMORY_AUTO_EXTRACT=true. 기본 OFF. */
    heuristicEnabled: process.env.USER_MEMORY_AUTO_EXTRACT === 'true',
    /** LLM 추출 활성 — 사용자 메시지당 1콜(vLLM 부하). USER_MEMORY_LLM_EXTRACT=true. 기본 OFF. */
    llmEnabled: process.env.USER_MEMORY_LLM_EXTRACT === 'true',
    /** 사용자별 메모리 최대 개수(수동 저장과 공유 — 초과 시 자동형성 스킵). 컨트롤러와 동일 env. */
    maxCount: Number(process.env.USER_MEMORY_MAX_COUNT || '50'),
    /** 저장 콘텐츠 최소/최대 길이. */
    minLen: 4,
    maxLen: 300,
    /** LLM 추출이 한 메시지에서 만들 최대 메모리 수(폭주 방지). */
    llmMaxPerMessage: 3,
    /**
     * 휴리스틱 패턴 — 명시적 저장 의도. group>0 이면 그 캡처를 저장 콘텐츠로 사용.
     * (인라인 정규식 금지 정책 → 여기 config 로 외부화)
     */
    heuristicPatterns: [
        { re: /(.{4,200}?)\s*(?:을|를|은|는|이|가)?\s*(?:좀\s*)?기억\s*(?:해\s*(?:둬|줘|주세요|두세요)|하고\s*있어|해\s*두)/u, group: 1 },
        { re: /(.{4,200}?)\s*(?:을|를)?\s*잊지\s*(?:마|말아|말아줘|마세요)/u, group: 1 },
        { re: /(내\s*이름은\s*[^.?!\n]{1,80})/u, group: 1 },
        { re: /(나는\s*[^.?!\n]{2,120}?(?:를|을)\s*(?:선호|좋아)해)/u, group: 1 },
    ] as ReadonlyArray<{ re: RegExp; group: number }>,
};

/** LLM 추출 프롬프트 — 지속적 사용자 사실만 짧은 줄로, 없으면 정확히 NONE. */
export function getMemoryExtractionMessages(text: string): { system: string; user: string } {
    return {
        system:
            '너는 대화에서 "다음 대화에도 계속 유용한 사용자 고유 사실"만 뽑는 추출기다. '
            + '이름·선호·직업·언어·프로젝트·반복 요청 같은 지속적 사실만 추출한다. '
            + '일회성 질문·잡담·시간의존 정보는 제외한다. 각 사실을 한 줄로, 최대 3개, 한국어로 간결히 출력한다. '
            + '추출할 게 없으면 정확히 NONE 만 출력한다. 설명·번호·따옴표 없이 사실 문장만.',
        user: text.slice(0, 2000),
    };
}
