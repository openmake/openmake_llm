/**
 * 대화 읽기 전용 공유 한도 (198). 운영 튜닝이 필요해지기 전까지 env 로 열지 않는다.
 *
 * 한도를 넘으면 부분 공유·조용한 절단 없이 413 으로 거절한다.
 *
 * @module config/conversation-share
 */
export const CONVERSATION_SHARE = {
    /** 공유 문서에 담을 수 있는 최대 메시지 수(user·assistant). */
    MAX_MESSAGES: 500,
    /** 직렬화한 공유 문서의 UTF-8 최대 크기. */
    MAX_DOCUMENT_BYTES: 1024 * 1024,
    /** 서버 보관 미리보기 유효기간. */
    PREVIEW_TTL_MS: 15 * 60 * 1000,
    /** link 범위 토큰 난수 바이트(base64url). */
    TOKEN_BYTES: 24,
} as const;
