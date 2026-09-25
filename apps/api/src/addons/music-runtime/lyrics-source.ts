/**
 * music-runtime — 대화 속 가사 찾기 (2026-09-26).
 * Planner 가 긴 가사를 계획 JSON 에 옮겨 적다 출력·시간 상한에 걸려 음악이 한 번도 실행되지 않던 결함(697자 가사 → 로컬 27B
 * 15초 초과, 라이브 재현)을 막는다. Planner 는 PLAN_CONVERSATION_TEXT_MARKER 만 적고, 실행기가 여기서 원문을 찾는다.
 * @module addons/music-runtime/lyrics-source
 */
import {
    LYRICS_HEADER_MAX_CHARS, LYRICS_MIN_SECTIONS, LYRICS_NOTE_LINE_PATTERN, LYRICS_SECTION_HEADER_PATTERN,
    LYRICS_TRAILING_REQUEST_MAX_CHARS, LYRICS_TRAILING_REQUEST_PATTERN,
} from './lyrics-config';

function sectionName(line: string): string | null {
    if (line.trim().length > LYRICS_HEADER_MAX_CHARS) return null;
    const m = LYRICS_SECTION_HEADER_PATTERN.exec(line);
    return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

/**
 * 텍스트에서 가사 블록을 뽑는다 — 구간 표시가 LYRICS_MIN_SECTIONS 개 이상일 때만(아니면 '').
 * 첫 구간 표시 앞(제목·장르 메모)은 버리고, 구간 표시는 ACE-Step 구조 태그 `[이름]` 으로, 메모 줄·구분선은 빼고,
 * 끝에 붙은 요청 문장은 걷어낸다.
 */
export function extractLyrics(text: string): string {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const headerIdx = lines.map((l, i) => (sectionName(l) ? i : -1)).filter((i) => i >= 0);
    if (headerIdx.length < LYRICS_MIN_SECTIONS) return '';
    const out: string[] = [];
    for (const line of lines.slice(headerIdx[0])) {
        const name = sectionName(line);
        if (name) { out.push(`[${name}]`); continue; }
        if (LYRICS_NOTE_LINE_PATTERN.test(line)) continue;
        out.push(line.trim());
    }
    while (out.length > 0) {
        const last = out[out.length - 1];
        const isRequest = last.length <= LYRICS_TRAILING_REQUEST_MAX_CHARS && LYRICS_TRAILING_REQUEST_PATTERN.test(last) && !last.startsWith('[');
        if (last === '' || isRequest) out.pop(); else break;
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 대화에서 가사 찾기 — 현재 사용자 메시지 → 최근 답변(최신 순). 찾은 곳을 함께 돌려준다. */
export function conversationLyrics(userMessage: string, recentAssistantMessages: readonly string[] | undefined): { lyrics: string; source: string } | null {
    const fromUser = extractLyrics(userMessage);
    if (fromUser) return { lyrics: fromUser, source: 'user-message' };
    for (const [i, m] of (recentAssistantMessages ?? []).entries()) {
        const found = extractLyrics(m);
        if (found) return { lyrics: found, source: `assistant-message-${i + 1}` };
    }
    return null;
}
