import { detectOutputRepetition } from './output-repetition';
import { AGENT_TASK_TURN_LOOP } from '../../config/agent-task-turn-loop';

const unit = '다음 단계로 설정 파일을 다시 확인하고 테스트를 실행한 뒤 결과를 정리해서 보고하겠습니다. 잠시만 기다려 주세요. ';

describe('detectOutputRepetition — 응답 본문의 짧은 구간 반복', () => {
    it('같은 구간이 임계 횟수 이상 되풀이되면 횟수와 표본을 돌려준다', () => {
        expect(unit.length).toBeGreaterThanOrEqual(AGENT_TASK_TURN_LOOP.OUTPUT_REPETITION_WINDOW_CHARS);
        const r = detectOutputRepetition(`서론입니다.\n${unit.repeat(7)}`);
        expect(r).not.toBeNull();
        expect(r!.repeats).toBeGreaterThanOrEqual(AGENT_TASK_TURN_LOOP.OUTPUT_REPETITION_MIN_REPEATS);
        expect(unit.repeat(2)).toContain(r!.sample);
    });

    it('임계 미만의 반복과 보통 글은 잡지 않는다', () => {
        expect(detectOutputRepetition(unit.repeat(AGENT_TASK_TURN_LOOP.OUTPUT_REPETITION_MIN_REPEATS - 1))).toBeNull();
        const prose = Array.from({ length: 80 }, (_, i) => `${i}번째 항목은 값이 ${i * 37}이고 상태는 ${i % 3 === 0 ? '정상' : '확인 필요'}입니다.`).join('\n');
        expect(detectOutputRepetition(prose)).toBeNull();
        expect(detectOutputRepetition('')).toBeNull();
        expect(detectOutputRepetition(null)).toBeNull();
    });

    it('구분선·공백처럼 글자 종류가 적은 구간은 반복으로 보지 않는다', () => {
        expect(detectOutputRepetition(`제목\n${'-'.repeat(600)}\n본문`)).toBeNull();
        expect(detectOutputRepetition(`${'| --- '.repeat(120)}|`)).toBeNull();
    });

    it('겹쳐 있는 구간은 한 번으로 센다', () => {
        // 60자보다 조금 긴 문장 하나는 창을 한 글자씩 밀어도 반복이 아니다.
        expect(detectOutputRepetition(unit)).toBeNull();
    });
});
