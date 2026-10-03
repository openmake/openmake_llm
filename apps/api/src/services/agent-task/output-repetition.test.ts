import { detectOutputRepetition, cutRepeatedOutput, retryRepeatedAnswer } from './output-repetition';
import { OUTPUT_REPETITION_CUT_MARKER, getOutputRepetitionRetryNudge } from '../../prompts/agent-task-turn-loop';
import type { ChatMessage } from '../../llm/types';
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

describe('detectOutputRepetition — 반복이 시작된 지점', () => {
    it('cutAt 은 되풀이되는 단위가 한 번 끝난 자리다(앞의 글과 첫 단위는 남는다)', () => {
        const intro = '분석 결과를 정리합니다.\n';
        const text = `${intro}${unit.repeat(7)}`;
        const r = detectOutputRepetition(text)!;
        expect(text.slice(0, r.cutAt)).toBe(`${intro}${unit}`);
        expect(cutRepeatedOutput(text, r.cutAt)).toBe(`${intro}${unit.trimEnd()}${OUTPUT_REPETITION_CUT_MARKER}`);
    });

    it('반례 — 같은 머리글 행을 가진 표가 여럿이어도 걸리지 않는다', () => {
        const header = '| 지역 이름 | 2026년 3분기 매출(백만 원) | 전년 동기 대비 증감률 | 담당 부서와 비고 사항 |\n| --- | --- | --- | --- |\n';
        expect(header.length).toBeGreaterThanOrEqual(AGENT_TASK_TURN_LOOP.OUTPUT_REPETITION_WINDOW_CHARS);
        const tables = Array.from({ length: 7 }, (_, t) =>
            `### ${t + 1}월 실적\n${header}${Array.from({ length: 3 }, (_, i) => `| 지역${t}-${i} | ${(t + 1) * (i + 3) * 17} | ${t - i}% | 영업 ${i}팀 |`).join('\n')}\n`).join('\n');
        expect(detectOutputRepetition(tables)).toBeNull();
    });

    it('반례 — 같은 접두로 시작하는 목록 항목은 걸리지 않는다', () => {
        const prefix = '- 2026년 3분기 서울 지역 영업 본부 매출 실적 보고서의 요약 항목(단위: 백만 원, 부가세 별도) — ';
        expect(prefix.length).toBeGreaterThanOrEqual(AGENT_TASK_TURN_LOOP.OUTPUT_REPETITION_WINDOW_CHARS);
        const list = Array.from({ length: 12 }, (_, i) => `${prefix}${i + 1}번 지점: ${(i + 2) * 131}`).join('\n');
        expect(detectOutputRepetition(list)).toBeNull();
    });
});

describe('retryRepeatedAnswer — 반복으로 잘린 최종 답변은 한 번 다시 요청한다', () => {
    const cut = (content: string, extra: Record<string, unknown> = {}) => ({ result: { role: 'assistant' as const, content, metrics: { prompt_tokens: 100, completion_tokens: 40 }, ...extra }, repetitionCut: true });
    const conv = (): ChatMessage[] => [{ role: 'system', content: 's' }, { role: 'user', content: 'g' }];

    it('도구 호출이 없는(최종 답이 될) 응답이면 잘린 본문과 안내를 대화에 넣고 다시 부른다 — 토큰은 합친다', async () => {
        const conversation = conv();
        const onNote = jest.fn();
        const recall = jest.fn(async () => ({ result: { role: 'assistant' as const, content: '정리된 답', metrics: { prompt_tokens: 150, completion_tokens: 10 } } }));
        const out = await retryRepeatedAnswer({ conversation, onNote }, cut('잘린 답'), recall);
        expect(recall).toHaveBeenCalledTimes(1);
        expect(out.result.content).toBe('정리된 답');
        expect(out.result.metrics).toEqual(expect.objectContaining({ prompt_tokens: 250, completion_tokens: 50 }));
        expect(conversation.slice(-2)).toEqual([{ role: 'assistant', content: '잘린 답' }, { role: 'user', content: getOutputRepetitionRetryNudge() }]);
        expect(onNote).toHaveBeenCalledWith('retry', expect.stringContaining('1/1'));
    });

    it('이미 한 번 다시 요청했으면 더 요청하지 않는다(최대 1회)', async () => {
        const conversation = [...conv(), { role: 'assistant' as const, content: 'x' }, { role: 'user' as const, content: getOutputRepetitionRetryNudge() }];
        const recall = jest.fn();
        const first = cut('또 잘린 답');
        expect(await retryRepeatedAnswer({ conversation }, first, recall)).toBe(first);
        expect(recall).not.toHaveBeenCalled();
        expect(conversation).toHaveLength(4);
    });

    it('도구 호출이 함께 온 응답과 잘리지 않은 응답은 다시 요청하지 않는다', async () => {
        const recall = jest.fn();
        const withTools = cut('잘린 본문', { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'bash', arguments: {} } }] });
        expect(await retryRepeatedAnswer({ conversation: conv() }, withTools, recall)).toBe(withTools);
        const plain = { result: { role: 'assistant' as const, content: '보통 답' } };
        expect(await retryRepeatedAnswer({ conversation: conv() }, plain, recall)).toBe(plain);
        expect(recall).not.toHaveBeenCalled();
    });
});
