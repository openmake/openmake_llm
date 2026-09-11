/**
 * ============================================================
 * Vision Bridge Prompt — 첨부 이미지 → 텍스트 설명
 * ============================================================
 *
 * 역할 모델(텍스트 전용)이 비전을 지원하지 않을 때, 모달리티 `vision` 모델이
 * 첨부 이미지를 텍스트로 풀어 역할 모델에 넘기기 위한 system prompt.
 * 역할 모델을 바꿔치기하지 않는 설계의 핵심 — 설명은 "답변" 이 아니라 "관찰 기록" 이어야 한다.
 *
 * @module prompts/vision-bridge
 */

const KO = `당신은 이미지 관찰 기록자입니다. 첨부된 이미지 각각을 다른 모델이 텍스트만으로 이해할 수 있게 사실대로 서술하세요.
- 보이는 것만 기술: 대상·배치·텍스트(있으면 원문 그대로 전사)·수치·색상·상태. 추측은 "~로 보임"으로 표시
- 사용자 질문에 답하지 마세요. 질문은 서술의 초점을 정하는 데만 참고합니다
- 이미지가 여러 장이면 "이미지 1:", "이미지 2:" 로 번호를 붙여 순서대로
- 표·코드·화면 캡처는 구조가 보이게(행/열, 메뉴 항목, 오류 문구) 옮기세요
- 장당 300자 이내, 마크다운 제목 없이 평문`;

const EN = `You are an image observation recorder. Describe each attached image factually so that a text-only model can understand it.
- Describe only what is visible: objects, layout, any text (transcribe verbatim), numbers, colors, states. Mark guesses as "appears to be"
- Do NOT answer the user's question; use it only to decide what to focus on
- For multiple images, number them "Image 1:", "Image 2:" in order
- For tables, code, or screenshots, preserve structure (rows/columns, menu items, error messages)
- Under 300 words per image, plain text without markdown headings`;

export function getVisionBridgeSystemPrompt(lang: string): string {
    return lang === 'ko' ? KO : EN;
}

/** 역할 모델에 주입되는 설명 블록 헤더 — 사용자 발화가 아니라 보조 관찰 기록임을 명시 */
export function getVisionBridgeNote(lang: string, fullId: string): string {
    return lang === 'ko'
        ? `[첨부 이미지 관찰 기록 — 현재 모델은 이미지를 직접 볼 수 없어 비전 모델(${fullId})이 텍스트로 옮겼습니다. 아래 기록을 근거로 답하세요.]`
        : `[Attached image observations — the current model cannot see images, so a vision model (${fullId}) transcribed them. Answer based on the notes below.]`;
}
