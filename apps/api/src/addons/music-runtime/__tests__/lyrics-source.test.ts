/**
 * music-runtime — 대화 속 가사 찾기 (2026-09-26). 입력은 실제 운영 사례(사용자가 붙여 넣은 가사 · 모델이 아티팩트로 쓴 가사).
 */
import { conversationLyrics, extractLyrics } from '../lyrics-source';

// 2026-09-26 사용자 3 이 붙여 넣은 가사(요약) — 구간 표시가 줄 단독이고 끝에 요청 문장이 붙는다.
const USER_PASTE = [
    "삼천리 (We'll Never Fade)",
    '장르: K-pop 발라드-일렉트릭 / 128 BPM / G 마조 / 보컬: 한국어 메인 + 영문 훅',
    '',
    'A1',
    '거울 속 너의 눈빛이 나를 깨우고',
    '',
    'Pre-Chorus',
    '두근두근, 심장이 불러',
    '',
    'Chorus',
    "삼천리 길을 달려 We'll never fade",
    '',
    'Final Chorus',
    '(서브 베이스 + 시퀀서 신트 풀 증폭) 삼천리 길을 달려',
    '',
    'Bridge (반음 상승)',
    '잊을 수 없어 그 날의 우리',
    '',
    '위 가사로 노래를 만들어줘.',
].join('\n');

// 같은 날 모델이 아티팩트로 쓴 가사(요약) — 마크다운 제목·이탤릭 메모·구분선.
const ARTIFACT = [
    '# 삼천리 (We Never Fade)',
    '**장르**: K-pop 발라드 | **BPM**: 128',
    '',
    '---',
    '',
    '## Intro (8beat 신스 아트워크)',
    '*(spoken)*',
    'Yeah… 한 번 더, 우리 이야기로.',
    '',
    '## Verse 1',
    '아침이 내리는 골목길에',
    '',
    '## Chorus (원곡 멜로디 훅, 보컬 + 시퀀서 신트)',
    '삼천리 방방곡곡',
].join('\n');

describe('extractLyrics', () => {
    test('붙여 넣은 가사 — 제목·장르 메모와 끝의 요청 문장을 빼고 구간을 구조 태그로', () => {
        const out = extractLyrics(USER_PASTE);
        expect(out.startsWith('[A1]\n거울 속 너의 눈빛이 나를 깨우고')).toBe(true);
        expect(out).toContain('[Pre-Chorus]');
        expect(out).toContain('[Final Chorus]');
        expect(out).toContain('[Bridge]');
        expect(out).not.toMatch(/장르|128 BPM|만들어줘/);
        expect(out.endsWith('잊을 수 없어 그 날의 우리')).toBe(true);
    });

    test('아티팩트 가사 — 마크다운 제목을 태그로, 이탤릭 괄호 메모·구분선은 뺀다', () => {
        const out = extractLyrics(ARTIFACT);
        expect(out.split('\n')[0]).toBe('[Intro]');
        expect(out).toContain('[Verse 1]\n아침이 내리는 골목길에');
        expect(out).toContain('[Chorus]\n삼천리 방방곡곡');
        expect(out).not.toMatch(/spoken|---|BPM/);
    });

    test('구간 표시가 하나뿐이거나 없는 글은 가사로 보지 않는다', () => {
        expect(extractLyrics('애국가를 케이팝 스타일로 편곡해서 노래로 만들어')).toBe('');
        expect(extractLyrics('Hook: 이 문장만 있다\n그리고 설명')).toBe('');
        expect(extractLyrics('A day in the life\nBridge over troubled water 는 명곡이다')).toBe('');
    });
});

describe('conversationLyrics', () => {
    test('사용자 메시지 우선, 없으면 최근 답변(최신 순)', () => {
        expect(conversationLyrics(USER_PASTE, [ARTIFACT])?.source).toBe('user-message');
        expect(conversationLyrics('이 가사로 노래 만들어줘', ['설명뿐인 답변', ARTIFACT])).toMatchObject({ source: 'assistant-message-2' });
        expect(conversationLyrics('이 가사로 노래 만들어줘', ['설명뿐인 답변'])).toBeNull();
    });
});
