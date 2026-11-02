/**
 * 한국어 조사 선택 — 이름·명사 뒤 조사를 받침 유무로 고른다.
 *
 * 사용자에게 보이는 문구에서 `이(가)`·`을(를)` 같은 미결정 표기를 쓰면 어색하다
 * (2026-09-13 라이브: 토론 진행 표시가 "심리학자이(가) 의견을 제시하고 있습니다").
 * 한글이 아닌 끝(영문·숫자·이모지)은 관용상 받침 없음으로 본다.
 *
 * @module utils/korean-particle
 */

/** 마지막 글자가 한글이고 받침이 있으면 true. 한글이 아니면 false(관용). */
export function hasFinalConsonant(word: string): boolean {
    const trimmed = word.trim();
    if (!trimmed) return false;
    const code = trimmed.charCodeAt(trimmed.length - 1);
    if (code < 0xac00 || code > 0xd7a3) return false;
    return (code - 0xac00) % 28 !== 0;
}

/** 주격 조사 — '이'/'가' */
export function subjectParticle(word: string): string {
    return hasFinalConsonant(word) ? '이' : '가';
}

/** 목적격 조사 — '을'/'를' */
export function objectParticle(word: string): string {
    return hasFinalConsonant(word) ? '을' : '를';
}
