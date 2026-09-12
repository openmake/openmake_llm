/**
 * 분해 폴백 서브토픽 검색어 회귀 테스트.
 *
 * 2026-09-13 라이브: 주제 분해가 실패해 템플릿 폴백으로 넘어갔는데, 폴백이 `topic`(사용자 발화
 * 원문)을 그대로 검색어에 붙여 "국내 전기버스 보급 현황을 아주 짧게 조사해줘. 개요" 같은 쿼리가
 * 나갔다. 그 결과 보고서 참고문헌에 무관한 문서(국어 연감·지진·게임 위키)가 실렸다.
 *
 * 검색어는 지시문을 벗긴 주제어, 제목은 사용자에게 보이는 원문 — 되돌리면 실패한다.
 */
import { buildFallbackSubTopics } from '../../deep-research-utils';

describe('폴백 서브토픽 검색어', () => {
    const utterance = '국내 전기버스 보급 현황을 아주 짧게 조사해줘.';

    it('검색어에 지시문("조사해줘"·"짧게")이 남지 않는다', () => {
        const queries = buildFallbackSubTopics(utterance).flatMap(s => s.searchQueries);
        expect(queries.length).toBeGreaterThan(0);
        for (const q of queries) {
            expect(q).not.toMatch(/조사해줘|짧게|알려줘/);
        }
    });

    it('핵심 주제어는 검색어에 보존된다', () => {
        const queries = buildFallbackSubTopics(utterance).flatMap(s => s.searchQueries);
        expect(queries.every(q => q.includes('전기버스'))).toBe(true);
    });

    it('제목은 사용자 발화 원문을 유지한다 (화면 표시용)', () => {
        expect(buildFallbackSubTopics(utterance)[0]!.title).toContain(utterance);
    });

    it('연도는 하드코딩이 아니라 현재 연도를 쓴다', () => {
        const queries = buildFallbackSubTopics(utterance).flatMap(s => s.searchQueries);
        const yearQuery = queries.find(q => /\d{4} 트렌드/.test(q));
        expect(yearQuery).toContain(`${new Date().getFullYear()} 트렌드`);
    });

    it('명사 용법 "조사 결과" 는 깎지 않는다', () => {
        const queries = buildFallbackSubTopics('국내 실태 조사 결과 분석').flatMap(s => s.searchQueries);
        expect(queries.every(q => q.includes('조사 결과'))).toBe(true);
    });
});
