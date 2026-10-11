/**
 * 검색어 정리기 — 지시 표현("웹에서 검색해서")과 시점 한정 표현("오늘 기준")이 검색어에 남지 않는지.
 *
 * 배경(2026-10-12 로컬·운영 로그): "오늘 기준 최신 Node.js LTS 버전을 웹에서 검색해서 알려줘" 가
 * "오늘 기준 최신 Node.js LTS 버전을 웹에서 해서" 로 나가 무관한 결과(MDN 용어집·Docker Hub)가 주입됐다.
 * "검색" 낱말만 지워지고 앞의 "웹에서"와 뒤의 활용 어미 "해서"가 남은 것.
 */
import { cleanSearchQuery } from '../query-cleaner';

describe('cleanSearchQuery — 검색 지시 표현', () => {
    it('실측 문장: 지시 표현과 시점 한정 표현이 모두 빠진다', () => {
        expect(cleanSearchQuery('오늘 기준 최신 Node.js LTS 버전을 웹에서 검색해서 알려줘')).toBe('최신 Node.js LTS 버전을');
    });

    it.each([
        ['Node.js LTS 버전을 웹에서 검색해서 알려줘', 'Node.js LTS 버전을'],
        ['Node.js LTS 버전을 인터넷에서 검색해 알려줘', 'Node.js LTS 버전을'],
        ['Node.js LTS 버전을 온라인에서 검색하고 정리해줘', 'Node.js LTS 버전을'],
        ['Node.js LTS 버전을 웹에서 검색하여 알려주세요', 'Node.js LTS 버전을'],
        ['Node.js LTS 버전을 인터넷으로 검색한 뒤 알려줘', 'Node.js LTS 버전을'],
        ['Node.js LTS 버전을 웹에서 찾아서 알려줘', 'Node.js LTS 버전을'],
        ['Node.js LTS 버전을 인터넷에서 찾아줘', 'Node.js LTS 버전을'],
        ['웹 검색해서 Node.js LTS 버전 알려줘', 'Node.js LTS 버전'],
        ['웹상에서 검색해보고 Node.js LTS 버전 알려줘', 'Node.js LTS 버전'],
    ])('장소 + 검색 동사를 통째로 걷어낸다: %s', (input, expected) => {
        expect(cleanSearchQuery(input)).toBe(expected);
    });

    it.each([
        ['Node.js LTS 버전 검색해서 알려줘', 'Node.js LTS 버전'],
        ['Node.js LTS 버전 검색해줘', 'Node.js LTS 버전'],
        ['Node.js LTS 버전 검색해 주세요', 'Node.js LTS 버전'],
        ['Node.js LTS 버전 검색하고 알려줘', 'Node.js LTS 버전'],
        ['Node.js LTS 버전 찾아서 알려줘', 'Node.js LTS 버전'],
        ['Node.js LTS 버전 찾아보고 알려줘', 'Node.js LTS 버전'],
    ])('장소 없이 쓴 검색 동사도 활용 어미가 남지 않는다: %s', (input, expected) => {
        expect(cleanSearchQuery(input)).toBe(expected);
    });

    it.each([
        ['웹에서 동작하는 게임 엔진 추천', '웹에서 동작하는 게임 엔진 추천'],
        ['인터넷에서 유행하는 밈', '인터넷에서 유행하는 밈'],
        ['온라인에서 살 수 있는 기계식 키보드', '온라인에서 살 수 있는 기계식 키보드'],
        ['웹 접근성 지침', '웹 접근성 지침'],
    ])('검색 동사가 바로 붙지 않은 "웹에서"·"인터넷에서"는 보존한다: %s', (input, expected) => {
        expect(cleanSearchQuery(input)).toBe(expected);
    });
});

describe('cleanSearchQuery — 시점 한정 표현', () => {
    it.each([
        ['오늘 기준 원달러 환율', '원달러 환율'],
        ['오늘 기준으로 원달러 환율', '원달러 환율'],
        ['현재 기준 최신 iOS 버전', '최신 iOS 버전'],
        ['지금 기준으로 가장 빠른 CPU', '가장 빠른 CPU'],
        ['현재 시점 기준 최신 iOS 버전', '최신 iOS 버전'],
        ['오늘 날짜 기준으로 최신 iOS 버전', '최신 iOS 버전'],
    ])('"기준(으로)"까지 구 전체를 걷어낸다: %s', (input, expected) => {
        expect(cleanSearchQuery(input)).toBe(expected);
    });

    it.each([
        ['오늘 날씨', '오늘 날씨'],
        ['오늘 뉴스', '오늘 뉴스'],
        ['오늘 서울 날씨 알려줘', '오늘 서울 날씨'],
        ['현재 대한민국 대통령', '현재 대한민국 대통령'],
        ['지금 상영 중인 영화', '지금 상영 중인 영화'],
        ['현재 기준금리', '현재 기준금리'],
        ['현재 기준 금리', '현재 기준 금리'],
        ['2026년 10월 기준 최저임금', '2026년 10월 기준 최저임금'],
        ['회계 기준 변경 내용', '회계 기준 변경 내용'],
    ])('"기준"이 붙지 않은 시점 낱말과 명사 "기준"은 보존한다: %s', (input, expected) => {
        expect(cleanSearchQuery(input)).toBe(expected);
    });
});

describe('cleanSearchQuery — 기존 동작 불변', () => {
    it('장황한 지시문에서 핵심어만 남긴다 (파일 머리 주석의 예)', () => {
        expect(cleanSearchQuery('지금 대한민국 대통령이 누구인지 웹 검색 결과를 바탕으로 한 문장으로 알려줘.')).toBe('지금 대한민국 대통령');
    });

    it('"조사"의 명사 용법은 보존한다', () => {
        expect(cleanSearchQuery('전기버스 실태 조사 결과')).toBe('전기버스 실태 조사 결과');
    });

    it('과잉 제거로 비면 원문을 돌려준다', () => {
        expect(cleanSearchQuery('웹에서 검색해서 알려줘')).toBe('웹에서 검색해서 알려줘');
        expect(cleanSearchQuery('오늘 기준')).toBe('오늘 기준');
    });
});

// 2026-10-12 점검: 지시 낱말 패턴에 낱말 경계가 없어 다른 낱말의 일부까지 지웠다
// ("검색어 순위" → "어 순위", "잘 알려진 사실" → "잘 진 사실", "뭐든지" → "든지").
describe('cleanSearchQuery — 낱말 경계', () => {
    it.each([
        ['검색 엔진 최적화 방법 알려줘', '검색 엔진 최적화 방법'],
        ['검색엔진 점유율', '검색엔진 점유율'],
        ['구글 검색 알고리즘 변경', '구글 검색 알고리즘 변경'],
        ['검색어 순위', '검색어 순위'],
        ['서울역 찾아가는 방법', '서울역 찾아가는 방법'],
        ['잘 알려진 사실', '잘 알려진 사실'],
        ['알려지지 않은 버그', '알려지지 않은 버그'],
        ['설명해야 하는 이유', '설명해야 하는 이유'],
        ['뭐든지 다 되는 도구', '뭐든지 다 되는 도구'],
        ['누구나 쓸 수 있는 도구', '누구나 쓸 수 있는 도구'],
        ['무엇보다 중요한 원칙', '무엇보다 중요한 원칙'],
    ])('다른 낱말의 일부는 지우지 않는다: %s', (input, expected) => {
        expect(cleanSearchQuery(input)).toBe(expected);
    });

    it.each([
        ['서울 맛집 검색', '서울 맛집'],
        ['이 영화 뭐야', '이 영화'],
        ['Rust 2026 로드맵 조사해서 알려줘요', 'Rust 2026 로드맵'],
        ['환율 전망 설명해줘', '환율 전망'],
    ])('지시 낱말 자체는 종전대로 지운다: %s', (input, expected) => {
        expect(cleanSearchQuery(input)).toBe(expected);
    });

    it.each([
        ['구글에서 검색해서 Node.js LTS 알려줘', 'Node.js LTS'],
        ['네이버에서 검색해줘 서울 날씨', '서울 날씨'],
        ['구글 검색 결과를 바탕으로 환율 알려줘', '환율'],
        ['인터넷 검색 결과를 바탕으로 대통령이 누구인지 알려줘', '대통령'],
    ])('검색 매체 표현도 지시의 일부면 걷어낸다: %s', (input, expected) => {
        expect(cleanSearchQuery(input)).toBe(expected);
    });

    it.each([
        ['웹에서 동작하는 게임 엔진', '웹에서 동작하는 게임 엔진'],
        ['네이버에서 일하는 방법', '네이버에서 일하는 방법'],
        ['구글 검색 알고리즘 변경 알려줘', '구글 검색 알고리즘 변경'],
    ])('검색 지시가 없는 매체 표현은 보존한다: %s', (input, expected) => {
        expect(cleanSearchQuery(input)).toBe(expected);
    });
});
