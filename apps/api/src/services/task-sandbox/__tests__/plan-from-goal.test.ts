/**
 * goal 번호 절차 → 초기 계획 파싱.
 *
 * 실측 배경(2026-08-28): plan 프로토콜 오류 28건 중 20건이 "goal 에 `[절차] 1)…7)` 이 있고
 * 모델이 그 번호로 plan_update 를 부르는데 TaskPlan 은 비어 있는" 형태였다. 실패 인자는
 * 대부분 `{step, status}` 뿐이라 빈 계획으로는 복구가 안 된다 — 번호를 그대로 심어야 한다.
 *
 * 오탐(절차가 아닌 번호를 계획으로 심는 것)이 이 기능의 실패 모드라 그 경계를 함께 고정한다.
 */
import { parseGoalPlanSteps } from '../planning';

const OPTS = { minItems: 3, maxItems: 20, maxTextChars: 160 };

/** 실패를 반복하던 실제 goal 의 구조(AI 트렌드 리포트 예약 작업). */
const REAL_GOAL = [
    '국내·국외 AI 트렌드 데일리 리포트를 "고정 디자인 템플릿"으로 생성한다.',
    '[규칙]',
    '- 검색은 web_search 도구를 사용하라. 스크래퍼 파이썬 파일 만들지 마라.',
    '- RUN_DATE 는 실제 실행일 날짜(YYYY-MM-DD)로 기입하라.',
    '[절차]',
    '1) 검색: 최근 24h 국내(한국)/국외(글로벌) AI 뉴스 — 투자/제품출시/정책·규제/인재.',
    '2) 검증: fact_check 로 핵심 사실 교차확인.',
    '3) 분석: 투자자·경영자·창업자 3관점으로 해석.',
    '4) 채울 키 확인: bash 로 `python3 /opt/report-template/render_report.py --keys` 실행.',
    '5) data.json 작성: file_ops(op=write, path=data.json)로 키를 모두 채운다. 값 규칙:',
    '  news = [{"region":"국내","src":출처}] — 국내·국외 각 3건 이상.',
    '6) 렌더: bash 로 `python3 /opt/report-template/render_report.py data.json report.html` 실행.',
    '7) 확인: 렌더러 출력에 "경고 —" 줄이 없어야 한다.',
].join('\n');

describe('parseGoalPlanSteps', () => {
    it('실제 실패 goal 의 [절차] 7단계를 순서대로 뽑는다', () => {
        const steps = parseGoalPlanSteps(REAL_GOAL, OPTS);
        expect(steps).toHaveLength(7);
        expect(steps[0]).toContain('검색');
        expect(steps[1]).toContain('fact_check');
        expect(steps[6]).toContain('확인');
        // 5) 의 하위 들여쓰기 줄은 앞 단계의 연속이라 별도 단계가 되면 안 된다.
        expect(steps.some((s) => s.startsWith('news ='))).toBe(false);
    });

    it('[규칙] 의 `-` 불릿은 단계로 세지 않는다', () => {
        const steps = parseGoalPlanSteps(REAL_GOAL, OPTS);
        expect(steps.some((s) => s.includes('스크래퍼'))).toBe(false);
    });

    it('`N.` 과 `N-` 형식도 인식한다', () => {
        expect(parseGoalPlanSteps('1. 하나\n2. 둘\n3. 셋', OPTS)).toEqual(['하나', '둘', '셋']);
        expect(parseGoalPlanSteps('1- 하나\n2- 둘\n3- 셋', OPTS)).toEqual(['하나', '둘', '셋']);
    });

    it('연속되지 않으면 거기까지만 — 번호가 튀는 목록을 통째로 삼키지 않는다', () => {
        expect(parseGoalPlanSteps('1) 하나\n2) 둘\n5) 다섯\n6) 여섯', OPTS)).toEqual([]);
        expect(parseGoalPlanSteps('1) 하나\n2) 둘\n3) 셋\n7) 일곱', OPTS)).toEqual(['하나', '둘', '셋']);
    });

    it('minItems 미만이면 절차가 아니라고 보고 심지 않는다 (오탐 방지)', () => {
        expect(parseGoalPlanSteps('1) 사과\n2) 배', OPTS)).toEqual([]);
    });

    it('인라인 번호는 단계가 아니다 — 줄 머리만 인정', () => {
        expect(parseGoalPlanSteps('다음을 비교해줘: 1) 사과 2) 배 3) 감', OPTS)).toEqual([]);
    });

    it('번호가 없는 평범한 goal 은 no-op', () => {
        expect(parseGoalPlanSteps('워크스페이스에 파일을 만들고 한 줄 써줘', OPTS)).toEqual([]);
        expect(parseGoalPlanSteps('', OPTS)).toEqual([]);
    });

    it('maxItems 로 자르고, 긴 단계 텍스트는 상한에서 잘라낸다', () => {
        const many = Array.from({ length: 30 }, (_, i) => `${i + 1}) 단계${i + 1}`).join('\n');
        expect(parseGoalPlanSteps(many, { ...OPTS, maxItems: 5 })).toHaveLength(5);

        const long = `1) ${'가'.repeat(300)}\n2) 둘\n3) 셋`;
        const steps = parseGoalPlanSteps(long, { ...OPTS, maxTextChars: 20 });
        expect(steps[0]).toHaveLength(21); // 20자 + '…'
        expect(steps[0].endsWith('…')).toBe(true);
    });

    it('목록이 1 로 다시 시작하면 새 목록으로 본다 (앞의 짧은 열은 버림)', () => {
        const g = '1) 예시\n\n[절차]\n1) 진짜1\n2) 진짜2\n3) 진짜3';
        expect(parseGoalPlanSteps(g, OPTS)).toEqual(['진짜1', '진짜2', '진짜3']);
    });
});
