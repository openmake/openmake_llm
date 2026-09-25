/**
 * music-runtime — 대화 속 가사 판별 규칙 (2026-09-26).
 * 계획 인자가 PLAN_CONVERSATION_TEXT_MARKER 로 "대화에 이미 있는 가사"를 가리키거나, 사용자가 가사를 붙여 넣고 가사를 비운 계획이
 * 오면 실행기가 사용자 메시지·최근 답변에서 가사 블록을 찾는다. 판별은 결정적(구간 표시 개수)이고 모델을 부르지 않는다.
 * @module addons/music-runtime/lyrics-config
 */

/**
 * 구간 표시 줄 — `[Verse 1]`·`## Chorus (훅)`·`**Bridge**`·`Pre-Chorus`·`A1`·`1절`·`후렴` 등.
 * 캡처 1 = 구간 이름(ACE-Step 구조 태그로 옮긴다). 한 줄이 이 표시만으로 끝나야 한다(뒤의 괄호 메모는 허용).
 */
export const LYRICS_SECTION_HEADER_PATTERN =
    /^\s*(?:#{1,6}\s*)?(?:[*_]{1,2})?\s*[[(]?\s*((?:final\s+|last\s+)?(?:intro|outro|verse|pre[- ]?chorus|post[- ]?chorus|chorus|hook|bridge|refrain|interlude|breakdown|drop|rap|[AB])(?:\s*\d+)?|\d+\s*절|후렴|브릿지|벌스|인트로|아웃트로|훅|간주|랩)\s*[\])]?\s*(?:[*_]{1,2})?\s*(?:[(:–-][^\n]{0,60})?$/i;

/** 구간 표시 줄 길이 상한 — 더 긴 줄은 가사 본문으로 본다 */
export const LYRICS_HEADER_MAX_CHARS = 72;

/** 가사로 인정하는 최소 구간 수 — 하나뿐이면 우연한 단어("Hook: …")일 수 있다 */
export const LYRICS_MIN_SECTIONS = 2;

/** 노래로 부르지 않을 메모 줄 — 괄호·이탤릭 괄호만으로 된 줄(`(spoken)`·`*(서브 베이스 증폭)*`)과 구분선 */
export const LYRICS_NOTE_LINE_PATTERN = /^\s*(?:[*_]{1,2})?\s*\([^\n]*\)\s*(?:[*_]{1,2})?\s*$|^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

/** 가사 끝에 붙은 요청 문장("위 가사로 노래를 만들어줘") — 끝에서부터만 걷어낸다 */
export const LYRICS_TRAILING_REQUEST_PATTERN = /(만들어|생성해|불러\s*줘|노래로|음원|작곡해|make\b|create\b|generate\b|sing\b|turn (?:it|this) into)/i;
export const LYRICS_TRAILING_REQUEST_MAX_CHARS = 120;
