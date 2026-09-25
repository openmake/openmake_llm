/**
 * Knowledge 입력 검증 상한 — 인라인 리터럴 금지(No-Hardcoding). 필드 길이 같은 구현 파라미터만 여기 둔다.
 * (정책값 — 파일 크기·문서 수·top-K 는 여기가 아니라 `knowledge_profiles` 데이터다.)
 *
 * @module addons/knowledge-runtime/validation
 */
export const KNOWLEDGE_VALIDATION = {
    /** Space 이름 길이(문자) */
    NAME_MIN: 1,
    NAME_MAX: 100,
    /** 설명 최대 길이(문자) */
    DESCRIPTION_MAX: 2_000,
    /** Space 지침 최대 길이(문자) — 주입 토큰 예산(knowledge_profiles.limits.maxInstructionTokens)과 별개의 입력 하드 캡 */
    INSTRUCTIONS_MAX: 8_000,
    /** 메모리 1건 입력 하드 캡(문자) — 정책 상한(limits.maxMemoryCharsPerItem)은 서비스가 프로필로 다시 검사한다 */
    MEMORY_CONTENT_MAX: 8_000,
    /** 아이콘 문자열 최대 길이 — 스키마 knowledge_spaces.icon VARCHAR(32) 와 짝 */
    ICON_MAX: 32,
    /** 프로필 이름 최대 길이 */
    PROFILE_NAME_MAX: 100,
} as const;
