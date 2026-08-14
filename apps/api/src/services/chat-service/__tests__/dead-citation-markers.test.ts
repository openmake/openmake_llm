/**
 * 죽은 인용 마커 결정적 제거 — stripDeadCitationMarkers / citationMarkersWereCleaned.
 * 모델(qwen)이 수집 목록에 없는 출처 번호를 지어내는 비순응(2026-08-15 실측 73% 순응)의 후처리 검증.
 */
import { stripDeadCitationMarkers, citationMarkersWereCleaned } from '../external-deterministic-append';

const VALID = new Set(['1', '2', '3', '8', '10']);

describe('stripDeadCitationMarkers', () => {
    test('수집 목록 밖 번호 마커는 제거된다 (선행 공백 포함)', () => {
        const r = stripDeadCitationMarkers('유가가 상승했다 [출처 14]. 다음 문장.', VALID);
        expect(r.content).toBe('유가가 상승했다. 다음 문장.');
        expect(r.removed).toBe(1);
    });

    test('유효 번호 마커는 그대로 유지된다', () => {
        const text = '사실이다 [출처 3]. 그리고 [Source 8]도.';
        const r = stripDeadCitationMarkers(text, VALID);
        expect(r.content).toBe(text);
        expect(r.removed).toBe(0);
    });

    test('복합 인용에서 일부만 유효하면 유효 번호로 재작성된다', () => {
        const r = stripDeadCitationMarkers('근거 [출처 3, 14]이다.', VALID);
        expect(r.content).toBe('근거 [출처 3]이다.');
        expect(r.removed).toBe(1);
    });

    test('7개 언어 라벨을 모두 인식한다', () => {
        const r = stripDeadCitationMarkers('a [Source 15] b [出典 14] c [来源 13] d [Fuente 12] e [Quelle 11]', VALID);
        expect(r.content).toBe('a b c d e');
        expect(r.removed).toBe(5);
    });

    test('라벨 없는 대괄호 숫자([14]·마크다운 링크·각주)는 건드리지 않는다', () => {
        const text = '배열 [14] 와 링크 [제목 99](https://x.com) 유지.';
        const r = stripDeadCitationMarkers(text, VALID);
        expect(r.content).toBe(text);
        expect(r.removed).toBe(0);
    });
});

describe('citationMarkersWereCleaned', () => {
    test('스트리밍본에 있던 마커가 최종본에서 사라지면 true', () => {
        expect(citationMarkersWereCleaned('본문 [출처 14] 끝', '본문 끝')).toBe(true);
    });

    test('복합 인용이 축소돼도 true', () => {
        expect(citationMarkersWereCleaned('근거 [출처 3, 14]', '근거 [출처 3]')).toBe(true);
    });

    test('마커 변화가 없으면 false (출처 목록 append 만 있어도)', () => {
        const streamed = '본문 [출처 3]';
        const final = '본문 [출처 3]\n\n---\n\n**출처**\n3. [제목](https://x.com)';
        expect(citationMarkersWereCleaned(streamed, final)).toBe(false);
    });

    test('마커가 아예 없으면 false', () => {
        expect(citationMarkersWereCleaned('그냥 본문', '그냥 본문 + 첨부')).toBe(false);
    });
});
