/**
 * Evidence Package 회귀 테스트 (2026-08-02).
 *
 * 종전 동작: 검색이 의견 생성·교차검토가 모두 끝난 뒤에야 1회 수행되고 최종 합성에만
 * 주입됐다. 전문가들은 파라메트릭 지식만으로 시의성 주제를 논했고, 도구 경유 경로
 * (orchestration-dispatch)는 webSearchFn 미주입 + enableFactCheck=false 라 검색이
 * 아예 0건이었다(라이브 확인).
 *
 * 변경: 검색을 의견 생성 *전* 1회로 옮겨 모든 전문가에게 같은 근거를 제공한다.
 * 검색 호출 횟수는 1회로 동일해야 한다(중복 검색 회귀 차단).
 */
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { createDiscussionEngine, toEvidenceQuery, type DiscussionSearchResult } from '../discussion-engine';

const SOURCES: DiscussionSearchResult[] = [
    { title: '2026 반도체 수출 규제 동향', url: 'https://example.com/a', snippet: '대중 수출 통제가 확대됐다.' },
    { title: 'HBM 공급 현황', url: 'https://example.com/b', snippet: 'HBM 수요가 급증했다.' },
];

/** 전문가에게 전달된 user 메시지를 모두 캡처하는 엔진을 만든다. */
function makeEngine(webSearchFn?: jest.Mock) {
    const prompts: Array<{ system: string; user: string }> = [];
    const generateResponse = jest.fn(async (system: string, user: string) => {
        prompts.push({ system, user });
        return '## 의견\n- 근거에 기반한 분석입니다.\n- 추가 고려사항이 있습니다.';
    });
    const engine = createDiscussionEngine(generateResponse as never, {
        maxAgents: 2,
        maxRounds: 1,
        enableCrossReview: false,
        enableFactCheck: true,
        enableDeepThinking: false,
        userLanguage: 'ko',
    });
    return { engine, prompts, webSearchFn };
}

describe('toEvidenceQuery — 검색 쿼리 정규화', () => {
    it('장문 주제는 첫 문장만 취해 상한으로 자른다', () => {
        // 라이브 회귀: 500자 주제를 그대로 검색해 전 백엔드가 0건을 반환했다.
        const long = '2026년 한국 반도체 산업이 직면한 최대 리스크를 다각도로 분석하라. '
            + '주요 쟁점은 다음과 같다: 1) 수출 통제 강화, 2) 인력 부족, 3) 소재 공급 불안';
        const q = toEvidenceQuery(long);
        expect(q.length).toBeLessThanOrEqual(80);
        expect(q).not.toContain('주요 쟁점');
        expect(q).toContain('반도체');
    });

    it('짧은 주제는 그대로 둔다', () => {
        expect(toEvidenceQuery('탄소세 도입 찬반')).toBe('탄소세 도입 찬반');
    });

    it('빈 입력에도 안전하다', () => {
        expect(toEvidenceQuery('')).toBe('');
    });
});

describe('Discussion — Evidence Package 선수집', () => {
    it('의견 생성 프롬프트에 근거가 포함된다', async () => {
        const webSearchFn = jest.fn().mockResolvedValue(SOURCES);
        const { engine, prompts } = makeEngine();

        await engine.startDiscussion('2026년 반도체 산업 리스크', webSearchFn as never);

        // 의견 생성 호출(첫 라운드) 중 최소 하나는 근거 URL 을 담고 있어야 한다.
        const withEvidence = prompts.filter(p => p.user.includes('example.com/a'));
        expect(withEvidence.length).toBeGreaterThan(0);
    });

    it('검색은 1회만 호출된다 (합성 단계 중복 검색 회귀 차단)', async () => {
        const webSearchFn = jest.fn().mockResolvedValue(SOURCES);
        const { engine } = makeEngine();

        await engine.startDiscussion('2026년 반도체 산업 리스크', webSearchFn as never);

        expect(webSearchFn).toHaveBeenCalledTimes(1);
    });

    it('검색 함수가 없으면 근거 없이도 토론이 완료된다 (fail-open)', async () => {
        const { engine } = makeEngine();
        const r = await engine.startDiscussion('일반 주제');
        expect(r.factChecked).toBe(false);
        expect(r.opinions.length).toBeGreaterThan(0);
    });

    it('검색이 실패해도 토론이 중단되지 않는다 (fail-open)', async () => {
        const webSearchFn = jest.fn().mockRejectedValue(new Error('search down'));
        const { engine } = makeEngine();

        const r = await engine.startDiscussion('일반 주제', webSearchFn as never);
        expect(r.factChecked).toBe(false);
        expect(r.opinions.length).toBeGreaterThan(0);
    });
});
