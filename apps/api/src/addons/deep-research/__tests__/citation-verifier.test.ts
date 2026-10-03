/**
 * citation-verifier.test.ts
 * verifyCitations 결정적 단위 테스트 — 정확값 assert.
 * 실제 보고서 calibration(혼재 형식 `[출처 N]`/`[N]`/`[Source N]`, References 섹션) 기반.
 */

import { verifyCitations } from '../citation-verifier';
import { DEEP_RESEARCH_CITATION } from '../config';

describe('verifyCitations', () => {
    test('4개 주장 중 3개 인용 → coverage 0.75', () => {
        const report = [
            '원격 근무는 집중 업무에 유리하다 [출처 1].',
            '사무실 근무는 대면 협업에 강점이 있다 [출처 2].',
            '하이브리드 모델이 둘의 균형을 제공한다 [출처 3].',
            '많은 기업이 이를 도입하고 있는 추세이다.',
        ].join('\n');

        const r = verifyCitations(report, 5);
        expect(r.skipped).toBe(false);
        expect(r.totalClaims).toBe(4);
        expect(r.citedClaims).toBe(3);
        expect(r.coverage).toBe(0.75);
        expect(r.invalidCitations).toEqual([]);
        expect(r.uncitedSamples).toEqual(['많은 기업이 이를 도입하고 있는 추세이다.']);
        expect(r.meetsTarget).toBe(false); // 0.75 < 0.95
    });

    test('소스 범위 밖 인용 → invalidCitations 검출', () => {
        const report = '이 주장은 존재하지 않는 소스를 인용한다 [출처 9].';
        const r = verifyCitations(report, 5); // 소스 5개뿐
        expect(r.totalClaims).toBe(1);
        expect(r.citedClaims).toBe(1);
        expect(r.invalidCitations).toEqual([9]);
        expect(r.coverage).toBe(1);
    });

    test('References 섹션은 커버리지에서 제외된다', () => {
        const report = [
            '본문의 유일한 주장 문장입니다 [출처 1].',
            '',
            '## 참고 자료',
            '[1] 제목 A - https://a.com',
            '[2] 제목 B - https://b.com',
        ].join('\n');

        const r = verifyCitations(report, 2);
        // References 의 [1][2] 가 주장으로 집계되면 안 됨 → 본문 1문장만
        expect(r.totalClaims).toBe(1);
        expect(r.citedClaims).toBe(1);
        expect(r.coverage).toBe(1);
        expect(r.invalidCitations).toEqual([]);
    });

    test('한국어 + 영어 혼합 문장 분리 및 [Source N] 매칭', () => {
        const report = '한국어 문장입니다 [출처 1]. This is an English sentence [Source 2].';
        const r = verifyCitations(report, 3);
        expect(r.totalClaims).toBe(2);
        expect(r.citedClaims).toBe(2);
        expect(r.coverage).toBe(1);
    });

    test('숫자형 [N] 인용도 매칭 (모델 드리프트 형식)', () => {
        const report = '제도는 민간주도로 개편되었다 [10]. 확인 절차는 45일 이내 소요된다 [32].';
        const r = verifyCitations(report, 50);
        expect(r.citedClaims).toBe(2);
        expect(r.coverage).toBe(1);
        expect(r.citationCount).toBe(2);
    });

    test('연속 인용 [출처 1][출처 61] 은 한 문장에서 2개로 카운트', () => {
        const report = '공식 지위를 인정받은 기업에만 해당한다 [출처 1][출처 61].';
        const r = verifyCitations(report, 100);
        expect(r.totalClaims).toBe(1);
        expect(r.citedClaims).toBe(1);
        expect(r.citationCount).toBe(2);
    });

    test('회귀: "주요 발견사항"(Findings 헤더)이 "주"에 걸려 본문이 잘리면 안 됨', () => {
        const report = [
            '## 종합 요약',
            '요약 문장 하나입니다 [출처 1].',
            '',
            '## 주요 발견사항',
            '핵심 발견 첫 번째 항목입니다 [출처 2].',
            '핵심 발견 두 번째 항목입니다 [출처 3].',
            '',
            '## 참고 자료',
            '[1] 제목 - https://a.com',
        ].join('\n');

        const r = verifyCitations(report, 5);
        // 요약(1) + 발견사항(2) = 3 문장이 모두 측정되어야 함 (참고 자료만 제외)
        expect(r.totalClaims).toBe(3);
        expect(r.citedClaims).toBe(3);
        expect(r.coverage).toBe(1);
    });

    test('공백 변형 "참고자료"(공백 없음)도 References로 제외', () => {
        const report = [
            '본문 주장입니다 [출처 1].',
            '## 참고자료',
            '[1] 제목 - https://a.com',
        ].join('\n');
        const r = verifyCitations(report, 3);
        expect(r.totalClaims).toBe(1);
    });

    test('fallback/실패 보고서 → skipped, coverage null (0% 오탐 방지)', () => {
        const r = verifyCitations('리서치 실패: 연결 오류가 발생했습니다.', 0);
        expect(r.skipped).toBe(true);
        expect(r.coverage).toBeNull();
        expect(r.meetsTarget).toBeNull();
    });

    test('빈 보고서 → skipped', () => {
        const r = verifyCitations('', 5);
        expect(r.skipped).toBe(true);
        expect(r.coverage).toBeNull();
    });

    test('목표 충족 시 meetsTarget=true', () => {
        const report = '모든 주장이 인용을 가진다 [출처 1]. 두 번째 주장도 인용된다 [출처 2].';
        const r = verifyCitations(report, 5);
        expect(r.coverage).toBe(1);
        expect(r.meetsTarget).toBe(true);
    });

    test('TARGET_COVERAGE 상수가 0~1 범위', () => {
        expect(DEEP_RESEARCH_CITATION.TARGET_COVERAGE).toBeGreaterThan(0);
        expect(DEEP_RESEARCH_CITATION.TARGET_COVERAGE).toBeLessThanOrEqual(1);
    });
});

describe('verifyCitations — 읽은 출처와 읽지 못한 출처', () => {
    const report = [
        '첫 주장은 본문을 읽은 출처를 인용한다 [출처 1].',
        '둘째 주장은 검색 요약만 있는 출처를 인용한다 [출처 2].',
        '셋째 주장은 읽은 출처와 못 읽은 출처를 함께 인용한다 [출처 1, 출처 3].',
        '넷째 주장은 인용이 없다고 볼 수 있는 문장이다.',
    ].join('\n');

    test('주장을 원문 확인·미입수·미인용으로 나눠 센다', () => {
        const r = verifyCitations(report, 3, new Set([1]));
        expect(r.claimStatus).toEqual({ read: 2, unreadOnly: 1, uncited: 1 });
        expect(r.unreadCitations).toEqual([2, 3]);
        // 기존 지표는 그대로다 — 커버리지는 인용 유무만 본다
        expect(r.citedClaims).toBe(3);
        expect(r.coverage).toBe(0.75);
    });

    test('읽은 출처 정보를 주지 않으면 상태를 계산하지 않는다(종전 호출과 호환)', () => {
        const r = verifyCitations(report, 3);
        expect(r.claimStatus).toBeUndefined();
        expect(r.unreadCitations).toBeUndefined();
    });

    test('범위 밖 인용은 미입수가 아니라 invalid 로만 센다', () => {
        const r = verifyCitations('이 주장은 없는 출처를 인용한다 [출처 9].', 3, new Set([1]));
        expect(r.invalidCitations).toEqual([9]);
        expect(r.unreadCitations).toEqual([]);
        expect(r.claimStatus).toEqual({ read: 0, unreadOnly: 1, uncited: 0 });
    });
});
