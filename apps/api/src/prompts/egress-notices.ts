/**
 * 반출 관문(config/egress-policy) 안내 문구 — 채팅이 내부 전용 턴에서 외부로 자료를 보내는 기능을 쓰지 않을 때.
 *
 * @module prompts/egress-notices
 */

const MODE_BLOCKED: Readonly<Record<string, string>> = {
    ko: '이 메시지에는 민감 자료(대외비 표시·자격증명·개인식별 정보 등)가 들어 있어, 외부 모델·외부 검색·외부 생성을 쓰는 모드로 처리하지 않았습니다. 모드를 끄고 다시 보내면 내부 모델로 답합니다.',
    en: 'This message contains sensitive data (confidentiality markings, credentials or personal identifiers), so it was not processed by a mode that uses external models, search or generation. Turn the mode off and send it again to get an answer from the internal model.',
};

/** 내부 전용 턴에 외부를 쓰는 모드(이미지 생성·토론·딥리서치 등)를 켰을 때의 답변. */
export function getEgressModeBlockedNotice(lang?: string): string {
    return MODE_BLOCKED[lang === 'ko' ? 'ko' : 'en'];
}

const MODEL_FALLBACK: Readonly<Record<string, string>> = {
    ko: '민감 자료가 들어 있어 외부 모델 대신 내부 모델로 답합니다.',
    en: 'The message contains sensitive data, so the internal model answers instead of the external one.',
};

/** model_fallback 이벤트 문구 — 내부 전용 턴에서 외부 모델을 내부 모델로 바꿨을 때. */
export function getEgressModelFallbackMessage(lang?: string): string {
    return MODEL_FALLBACK[lang === 'ko' ? 'ko' : 'en'];
}

/** 디스패처가 내부 전용 문맥에서 외부로 자료를 보내는 도구를 거절할 때의 도구 결과(모델이 읽는다). */
export function getEgressToolBlockedMessage(toolName: string): string {
    return `도구 "${toolName}" 은 실행하지 않았습니다 — 이 요청에는 민감 자료가 있어 외부로 자료를 보내는 도구를 쓸 수 없습니다(내부 전용). 외부 도구 없이 답하세요.`;
}
