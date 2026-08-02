/**
 * WEB_SEARCH_INTENT_PATTERNS 회귀 테스트 (2026-08-02).
 *
 * web_search 는 always-on 도구가 아니라 이 패턴 매칭 시에만 강제 포함된다
 * (ChatService.buildAllowedTools → external-provider 첫 턴 tool_choice).
 * 매칭에 실패하면 모델이 도구 없이 툴콜을 시도해 본문에 XML 이 노출됐다
 * (conversation_messages id=7441, 2026-08-01).
 */
import { WEB_SEARCH_INTENT_PATTERNS } from '../runtime-limits';

const matches = (msg: string) => WEB_SEARCH_INTENT_PATTERNS.some((re) => re.test(msg));

describe('WEB_SEARCH_INTENT_PATTERNS', () => {
    it.each([
        '인터넷 검색해서 오늘 날씨 알려줘',
        '코스피 지수랑 장미감 어제 어떻게 됐어?',
        '어제 코스피 종가 얼마야',
        '지금 환율 얼마야',
        '최근 비트코인 시세 어때',
        'search the web for KOSPI close',
    ])('시의성·검색 질의를 매칭한다: %s', (msg) => {
        expect(matches(msg)).toBe(true);
    });

    it.each([
        '피보나치 수열 코드 짜줘',
        '이 함수 리팩터링 해줘',
        '고맙습니다',
    ])('일반 질의는 매칭하지 않는다: %s', (msg) => {
        expect(matches(msg)).toBe(false);
    });
});
