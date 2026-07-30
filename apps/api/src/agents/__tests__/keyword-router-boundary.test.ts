/**
 * 라틴 약어 오매칭 회귀 가드.
 *
 * 키워드 매칭(keyword-router)과 토픽 패턴(topic-categories.json) 양쪽에서 라틴 약어가
 * 단어 경계 없이 부분 문자열로 매칭돼, 영어 질의가 엉뚱한 산업으로 라우팅됐다.
 *   ESS(에너지저장) ⊂ "ingress"  → Kubernetes 질문이 재생에너지 엔지니어로
 *   EV(전기차)      ⊂ "reverse"  → nginx 질문이 기계공학으로
 *   PR(홍보)        ⊂ "proxy"    → nginx 질문이 미디어로
 *   AI              ⊂ "rain"     → 하이쿠 요청이 데이터/AI 로
 * 경계가 풀리면 같은 증상이 조용히 재발하므로 양쪽을 모두 고정한다.
 */
import topicCategoriesData from '../../config/data/topic-categories.json';

type RawPattern = { source: string; flags?: string };
type RawCategory = { name: string; patterns?: RawPattern[]; excludePatterns?: RawPattern[] };

const categories = (topicCategoriesData as { topicCategories: RawCategory[] }).topicCategories;

/** 순수 라틴 약어 alternative (예: ESS, EV, PR) — 한글·혼합 토큰은 대상 아님 */
const BARE_LATIN_ALTERNATIVE = /^[A-Za-z][A-Za-z0-9]{0,5}$/;

describe('topic-categories.json — 라틴 약어 단어 경계', () => {
    it('모든 패턴의 라틴 약어에 \\b 경계가 있다', () => {
        const violations: string[] = [];

        for (const category of categories) {
            for (const field of ['patterns', 'excludePatterns'] as const) {
                for (const pattern of category[field] ?? []) {
                    for (const alt of pattern.source.split('|')) {
                        if (BARE_LATIN_ALTERNATIVE.test(alt.trim())) {
                            violations.push(`${category.name} [${field}]: ${alt.trim()}`);
                        }
                    }
                }
            }
        }

        expect(violations).toEqual([]);
    });

    it('경계 적용 후에도 한글이 붙은 약어는 매칭된다 (ESG경영)', () => {
        // \b 는 \w 기준이라 한글 인접은 경계로 인정된다 — 한국어 사용성이 깨지지 않음을 고정.
        const energy = categories.find(c => c.name.includes('에너지'));
        const esgPattern = energy?.patterns?.find(p => p.source.includes('ESG'));
        expect(esgPattern).toBeDefined();

        const re = new RegExp(esgPattern!.source, esgPattern!.flags ?? 'i');
        expect(re.test('ESG경영의 핵심 KPI는?')).toBe(true);
    });

    it('영어 단어 내부의 약어는 매칭되지 않는다 (ingress ⊅ ESS)', () => {
        const energy = categories.find(c => c.name.includes('에너지'));
        const essPattern = energy?.patterns?.find(p => p.source.includes('ESS'));
        expect(essPattern).toBeDefined();

        const re = new RegExp(essPattern!.source, essPattern!.flags ?? 'i');
        expect(re.test('How do I configure Kubernetes ingress rules?')).toBe(false);
        expect(re.test('ESS 도입을 검토 중입니다')).toBe(true);
    });

    it('모든 패턴이 정규식으로 컴파일된다', () => {
        for (const category of categories) {
            for (const pattern of category.patterns ?? []) {
                expect(() => new RegExp(pattern.source, pattern.flags ?? 'i')).not.toThrow();
            }
        }
    });
});
