/**
 * OpenAI 호환 엔드포인트 세션 연속성 설정.
 *
 * OpenAI 호환 클라이언트(Discord 봇 등)는 대화 세션 개념이 없어 매 요청이 독립적이다.
 * 동일 클라이언트의 연속 호출을 하나의 conversation 세션으로 묶기 위해, 요청 정보로부터
 * 결정적(deterministic) 세션 키를 유도해 세션 metadata 에 태깅하고 다음 호출에서 조회한다.
 */
export const OPENAI_COMPAT_SESSION = {
    /** 유도된 세션 키의 prefix — 일반 세션과 구분/디버깅용 식별자 */
    KEY_PREFIX: 'oaicompat-',
    /** sha256 hex 에서 취할 앞 글자 수 (32 = 128bit, 충돌 사실상 0) */
    HASH_HEX_LENGTH: 32,
    /** 세션 metadata 에 세션 키를 보관하는 필드명 (조회 키) */
    METADATA_FIELD: 'oaicompatKey',
} as const;
