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
        "What's the weather in Tokyo today? Look it up online.",
        'Can you look up the latest Nvidia earnings on the internet?',
        'search for Tokyo weather online',
        'Just google it for me',
        // 조사 요청 — "검색"이라는 말 없이 온다(2026-10-13: 도구가 빠져 모델이 지어내거나 툴콜 문자열을 본문에 냈다)
        '벤처기업확인기관에 대해서 조사해서 보고해',
        '이 회사 최근 투자 유치 현황 조사해줘',
        '경쟁사 가격 정책 좀 조사해 주세요',
        '위 내용이 사실인지 다시 조사해서 알려줘',
    ])('시의성·검색 질의를 매칭한다: %s', (msg) => {
        expect(matches(msg)).toBe(true);
    });

    it.each([
        '피보나치 수열 코드 짜줘',
        '이 함수 리팩터링 해줘',
        '고맙습니다',
        'Can you check if the server is online?',
        'How do I look up a key in a Python dict?',
        'Explain how online learning works',
        'Write a Google Docs add-on',
        // 사용자가 이미 한 조사를 말하는 문장 — 요청이 아니다
        '설문 조사해서 결과 정리했는데 표로 만들어줘',
        '어제 조사해 본 내용인데 요약해줘',
        '여론조사 결과를 설명해줘',
    ])('일반 질의는 매칭하지 않는다: %s', (msg) => {
        expect(matches(msg)).toBe(false);
    });
});
