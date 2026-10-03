import { checkDelegationGoal } from './delegation-input';

describe('checkDelegationGoal — 빈 껍데기 위임 목표 거부', () => {
    it('자기완결적인 목표는 통과한다', () => {
        expect(checkDelegationGoal('2026년 3분기 서울 아파트 실거래가 추이를 조사해 요약', { batch: true })).toBeNull();
        expect(checkDelegationGoal('Compare vLLM and TGI throughput on a single A100', { batch: true })).toBeNull();
    });

    it('맥락에 기대는 짧은 문장은 거부하고 이유를 준다 — 서브에이전트는 부모 대화를 못 본다', () => {
        for (const goal of ['위 작업 계속', '앞의 내용을 이어서 정리해줘', '방금 요청 마저 해', '계속 진행', 'continue the above', 'same as before']) {
            expect(checkDelegationGoal(goal, { batch: false })).toMatch(/맥락/);
        }
    });

    it('맥락 표현이 있어도 지시가 충분히 길면 통과한다', () => {
        const goal = '위 작업 계속: 서울·부산·대구의 2025년 월별 강수량 표를 만들고, 평년 대비 편차가 큰 달 세 개를 골라 이유를 설명';
        expect(checkDelegationGoal(goal, { batch: true })).toBeNull();
    });

    it('다른 낱말 속 글자에는 걸리지 않는다', () => {
        expect(checkDelegationGoal('조사 범위 내용을 표로 정리해줘', { batch: false })).toBeNull();
    });

    it('자리 표시 목표와 채워지지 않은 틀 표시를 거부한다', () => {
        expect(checkDelegationGoal('TODO', { batch: false })).toMatch(/자리 표시/);
        expect(checkDelegationGoal('태스크 2', { batch: false })).toMatch(/자리 표시/);
        expect(checkDelegationGoal('{{topic}} 의 시장 규모를 조사해 정리', { batch: false })).toMatch(/\{\{topic\}\}/);
        expect(checkDelegationGoal('<COMPANY_NAME> 의 최근 실적을 조사해 정리', { batch: false })).toMatch(/<COMPANY_NAME>/);
    });

    it('너무 짧은 목표는 여러 태스크를 한 번에 맡길 때만 거부한다 — 단일 위임의 짧은 목표는 정당할 수 있다', () => {
        expect(checkDelegationGoal('환율', { batch: true })).toMatch(/2자/);
        expect(checkDelegationGoal('fix bug', { batch: true })).toMatch(/7자/);
        expect(checkDelegationGoal('환율', { batch: false })).toBeNull();
    });

    it('한글·한자·가나는 글자당 정보량이 커 짧아도 정당한 지시가 통과한다', () => {
        for (const goal of ['서울 날씨 조사', '로그 요약', '환율 조사', '東京の天気を調査', '日志摘要']) {
            expect(checkDelegationGoal(goal, { batch: true })).toBeNull();
        }
    });

    it('내용이 없는 짧은 지시는 여전히 거부한다', () => {
        for (const goal of ['계속', '위와 같이', 'ㅇㅇ', '요약', 'ok']) {
            expect(checkDelegationGoal(goal, { batch: true })).not.toBeNull();
        }
        expect(checkDelegationGoal('위와 같이', { batch: true })).toMatch(/맥락/);
    });
});
