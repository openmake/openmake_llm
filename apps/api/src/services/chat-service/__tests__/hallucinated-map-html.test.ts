/**
 * 지도 환각 HTML 결정적 제거 — stripHallucinatedMapHtml / mapHtmlWasCleaned.
 * "kakaomap 블록 직접 작성 금지" 넛지 하에서 qwen 이 존재하지 않는 lmap.kakao.com
 * 정적 이미지 <img> 링크로 우회 환각한 라이브 사례(2026-08-20)의 후처리 검증.
 */
import { stripHallucinatedMapHtml, mapHtmlWasCleaned } from '../external-deterministic-append';

// 2026-08-20 라이브 관측 원문 그대로.
const LIVE_HALLUCINATION = `광화문 주변 검색 결과를 표시합니다.

<center> <a href="https://map.kakao.com/?itemtype=place&itemId=8234642&org.lat=37.57596445980707&org.lon=126.97685309595215"> <img src="https://lmap.kakao.com/view/new/detail/Zz926X9OJhZ8v7b5q9Y8Zz926X9O.jpg" width="500" height="400" alt="Kakao Map - 광화문"> </a> </center> <br>`;

describe('stripHallucinatedMapHtml', () => {
    test('라이브 관측 사례: <center><a><img></a></center> <br> 전체가 제거된다', () => {
        const r = stripHallucinatedMapHtml(LIVE_HALLUCINATION);
        expect(r.removed).toBe(1);
        expect(r.content).not.toMatch(/<img|<a |<center|<br/i);
        expect(r.content).toContain('광화문 주변 검색 결과를 표시합니다.');
    });

    test('단독 <img> (앵커 없음) 도 제거된다', () => {
        const r = stripHallucinatedMapHtml('지도: <img src="https://lmap.kakao.com/x/y.jpg" alt="map"> 입니다.');
        expect(r.removed).toBe(1);
        expect(r.content).toBe('지도:  입니다.');
    });

    test('마크다운 이미지 형태의 카카오 지도 URL 도 제거된다', () => {
        const r = stripHallucinatedMapHtml('![광화문 지도](https://t1.daumcdn.net/mapjs/fake.png)');
        expect(r.removed).toBe(1);
        expect(r.content).toBe('');
    });

    test('카카오 계열이 아닌 이미지/링크는 건드리지 않는다', () => {
        const text = '사진 ![a](https://example.com/a.png) 과 <img src="/generated/x.png"> 유지. [지도](https://map.kakao.com/?q=광화문) 텍스트 링크도 유지.';
        const r = stripHallucinatedMapHtml(text);
        expect(r.removed).toBe(0);
        expect(r.content).toBe(text);
    });

    test('kakaomap 코드 블록(결정적 주입 산출물)은 건드리지 않는다', () => {
        const text = '결과입니다.\n\n```kakaomap\n{"places":[{"name":"광화문","lat":37.57,"lng":126.97}]}\n```';
        const r = stripHallucinatedMapHtml(text);
        expect(r.removed).toBe(0);
        expect(r.content).toBe(text);
    });
});

describe('mapHtmlWasCleaned', () => {
    test('스트리밍본엔 환각 HTML 이 있고 최종본에선 제거됐으면 true', () => {
        const final = stripHallucinatedMapHtml(LIVE_HALLUCINATION).content;
        expect(mapHtmlWasCleaned(LIVE_HALLUCINATION, final)).toBe(true);
    });

    test('환각 HTML 이 없던 턴은 false', () => {
        expect(mapHtmlWasCleaned('일반 응답입니다.', '일반 응답입니다.')).toBe(false);
    });
});
