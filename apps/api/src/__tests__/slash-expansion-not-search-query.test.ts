/**
 * 슬래시 스킬 확장문이 **사전 웹검색의 입력으로 새지 않는지** 검증.
 *
 * 실측 배경 (2026-08-25, SearXNG 컨테이너 로그) — `/nginx-log-error-analysis-reporting`
 * 호출 시 다음이 그대로 검색어로 나갔다:
 *
 *     GET https://www.mojeek.com/search?q=[슬래시 명령: 스킬 "Nginx Log Error Analysis
 *     Reporting" 적용] <skill_context name="..."> **역할 / 전문성** 당신은 고성능 웹 서버인 ...
 *
 * 원인은 두 겹이다.
 *  (a) 시사 질의 감지가 **확장문**을 본다 — 스킬 본문 6,065자 안의 "최근"·"실시간" 같은
 *      단어가 걸려 사용자가 웹검색을 켜지 않았는데도 검색이 돈다.
 *  (b) 검색어도 **확장문**이다 — `cleanSearchQuery` 는 대화체 지시문만 걷어내고 개행을
 *      공백으로 눌러버려, 스킬 프롬프트 전체가 한 줄짜리 쿼리가 된다.
 *
 * 스킬 컨텍스트는 모델에게 주는 **지시**이지 사용자의 질문이 아니다. 검색 대상은 언제나
 * 사용자가 실제로 친 문장이어야 한다.
 */
import { buildWebSearchContext } from '../mcp/web-search/build-search-context';
import { cleanSearchQuery } from '../mcp/web-search/query-cleaner';
import { stripSlashEnvelope } from '../chat/slash-command';

jest.mock('../mcp/web-search/search-orchestrator', () => ({
    performWebSearch: jest.fn(async () => []),
}));

import { performWebSearch } from '../mcp/web-search/search-orchestrator';

/** 실제 결함을 낸 형태 그대로 — slash-command.ts 의 증강 포맷 */
const SKILL_BODY = [
    '**역할 / 전문성**',
    '당신은 고성능 웹 서버인 Nginx의 로그 데이터를 분석하고 시스템 안정성을 높이는 데 특화된 DevOps 전문가입니다.',
    '최근 발생한 오류를 실시간으로 집계해 보고서를 만듭니다.',
].join('\n');

const EXPANDED = `[슬래시 명령: 스킬 "Nginx Log Error Analysis Reporting" 적용]\n<skill_context name="Nginx Log Error Analysis Reporting">\n${SKILL_BODY}\n</skill_context>\n\n어제 로그 좀 정리해줘`;

const RAW = '어제 로그 좀 정리해줘';

beforeEach(() => jest.clearAllMocks());

describe('슬래시 확장문은 검색 입력이 아니다', () => {
    it('확장문에는 시사 키워드가 섞여 있다 (결함의 전제)', () => {
        // 스킬 본문이 "최근"을 포함 → 확장문을 감지에 쓰면 오검출된다
        expect(EXPANDED).toContain('최근');
        expect(RAW).not.toContain('최근');
    });

    it('원문 기준이면 웹검색이 트리거되지 않는다', async () => {
        const r = await buildWebSearchContext({
            message: RAW,
            userLang: 'ko',
            webSearchEnabled: false,
        });
        expect(r.isCurrentEventsQuery).toBe(false);
        expect(performWebSearch).not.toHaveBeenCalled();
    });

    it('확장문을 넘기면 사용자가 끄지 않았는데도 검색이 돈다 (회귀 가드)', async () => {
        const r = await buildWebSearchContext({
            message: EXPANDED,
            userLang: 'ko',
            webSearchEnabled: false,
        });
        // 이 단언은 "확장문을 넘기면 이렇게 잘못된다"를 고정한다 —
        // 호출부가 원문을 넘기도록 유지하는 것이 방어선이다.
        expect(r.isCurrentEventsQuery).toBe(true);
        expect(performWebSearch).toHaveBeenCalled();
    });

    it('2차 방어선 — 확장문이 새더라도 검색어에서는 봉투가 걷힌다', () => {
        const q = cleanSearchQuery(EXPANDED);
        expect(q).not.toContain('skill_context');   // 마크업 제거
        expect(q).not.toContain('슬래시 명령');       // 접두 마커 제거
        expect(q).not.toContain('당신은 고성능');      // 스킬 본문 제거
        expect(q).toContain('어제 로그');             // 사용자가 쓴 부분은 보존
        expect(q.length).toBeLessThan(50);
    });

    it('봉투가 없는 평범한 메시지는 손대지 않는다', () => {
        expect(stripSlashEnvelope('nginx 로그 분석해줘')).toBe('nginx 로그 분석해줘');
    });

    it('본문에 <skill_context> 라는 말이 나오는 정상 질문은 살아남는다', () => {
        // 닫는 태그가 없으면 블록 패턴이 걸리지 않는다 — 과잉 제거 방지
        const q = cleanSearchQuery('skill_context 태그가 뭐야');
        expect(q).toContain('skill_context');
    });

    it('원문은 정제 후에도 짧고 온전하다', () => {
        const q = cleanSearchQuery(RAW);
        expect(q).not.toContain('skill_context');
        expect(q.length).toBeLessThan(50);
    });
});
