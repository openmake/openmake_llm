/**
 * pseudo-tool-call-parser unit tests (2026-08-02).
 *
 * 회귀 대상: vLLM 이 tools 없는 요청에 툴 파서를 적용하지 않아 모델의 XML 툴콜이
 * `delta.content` 로 흘러나오고, 그대로 채팅창에 노출된 사례
 * (conversation_messages id=7441, qwen3.6-35b-a3b).
 *
 * 검증 영역:
 *   1. parsePseudoToolCalls  — 실제 누수 원문에서 tool call 복구
 *   2. PseudoToolCallGate    — 스트리밍 중 노출 차단 + 청크 경계 분할 내성
 *   3. stripPseudoToolCalls  — 비스트리밍 응답 처리
 */
import {
    PseudoToolCallGate,
    parsePseudoToolCalls,
    stripPseudoToolCalls,
} from '../pseudo-tool-call-parser';

/** 실제 노출 사례(id=7441) 의 툴콜 블록 원문. */
const LEAKED_RAW = `<tool_call>
<function=web_search>
<parameter=query>
코스피 지수 2026년 8월 1일 종가
</parameter>
</function>
</tool_call>`;

describe('parsePseudoToolCalls', () => {
    it('실제 누수 원문에서 도구명과 인자를 복구한다', () => {
        const calls = parsePseudoToolCalls(LEAKED_RAW);
        expect(calls).toHaveLength(1);
        expect(calls[0]!.name).toBe('web_search');
        expect(calls[0]!.args).toEqual({ query: '코스피 지수 2026년 8월 1일 종가' });
    });

    it('파라미터 여러 개와 JSON 리터럴 값을 캐스팅한다', () => {
        const calls = parsePseudoToolCalls(
            '<tool_call><function=web_search>'
            + '<parameter=query>서울 날씨</parameter>'
            + '<parameter=count>3</parameter>'
            + '<parameter=recent>true</parameter>'
            + '</function></tool_call>',
        );
        expect(calls[0]!.args).toEqual({ query: '서울 날씨', count: 3, recent: true });
    });

    it('닫는 태그 없이 절단된 블록도 복구한다', () => {
        const calls = parsePseudoToolCalls('<tool_call>\n<function=web_search>\n<parameter=query>코스피');
        expect(calls).toHaveLength(1);
        expect(calls[0]!.args).toEqual({ query: '코스피' });
    });

    it('툴콜이 아닌 텍스트에서는 아무것도 복구하지 않는다', () => {
        expect(parsePseudoToolCalls('안녕하세요. <tool_call> 이라는 태그를 설명합니다.')).toEqual([]);
    });
});

describe('PseudoToolCallGate (streaming)', () => {
    /** 델타 배열을 순서대로 넣고 사용자에게 방출된 텍스트를 모은다. */
    function run(deltas: string[]) {
        const gate = new PseudoToolCallGate();
        let emitted = '';
        for (const d of deltas) emitted += gate.feed(d);
        const flushed = gate.flush();
        emitted += flushed.emit;
        return { emitted, flushed };
    }

    it('툴콜이 없으면 모든 텍스트를 그대로 방출한다', () => {
        const { emitted, flushed } = run(['안녕', '하세요', ' 반갑습니다']);
        expect(emitted).toBe('안녕하세요 반갑습니다');
        expect(flushed.toolCalls).toEqual([]);
    });

    it('툴콜 블록은 사용자에게 방출하지 않고 tool call 로 복구한다', () => {
        const { emitted, flushed } = run(['계획을 세웠습니다.\n', LEAKED_RAW]);
        expect(emitted).toBe('계획을 세웠습니다.\n');
        expect(emitted).not.toContain('<tool_call>');
        expect(flushed.toolCalls).toHaveLength(1);
        expect(flushed.toolCalls[0]!.name).toBe('web_search');
    });

    it('여는 태그가 청크 경계로 쪼개져도 누수되지 않는다', () => {
        const { emitted, flushed } = run(['답변 전 계획: ', '<tool', '_call>', '\n<function=web_search>',
            '\n<parameter=query>코스피</parameter>\n</function>\n</tool_call>']);
        expect(emitted).toBe('답변 전 계획: ');
        expect(flushed.toolCalls[0]!.args).toEqual({ query: '코스피' });
    });

    it('부분 태그처럼 보였던 꼬리는 스트림 끝에서 되돌려 방출한다', () => {
        // '<tool' 로 끝나 유보됐지만 실제로는 툴콜이 아니었던 경우 — 본문 유실이 없어야 한다.
        const { emitted, flushed } = run(['수식 비교: a <tool']);
        expect(emitted).toBe('수식 비교: a <tool');
        expect(flushed.toolCalls).toEqual([]);
    });

    it('복구 불가한 블록은 본문으로 되돌리지 않고 원문을 관측용으로만 반환한다', () => {
        const { emitted, flushed } = run(['확인했습니다.', '<tool_call>{"name":"web_search"}</tool_call>']);
        expect(emitted).toBe('확인했습니다.');
        expect(flushed.toolCalls).toEqual([]);
        expect(flushed.unparsedRaw).toContain('<tool_call>');
    });
});

describe('stripPseudoToolCalls (non-stream)', () => {
    it('본문에서 툴콜 블록을 떼어내고 복구한다', () => {
        const r = stripPseudoToolCalls(`검색이 필요합니다.\n\n${LEAKED_RAW}`);
        expect(r.content).toBe('검색이 필요합니다.');
        expect(r.toolCalls).toHaveLength(1);
        expect(r.toolCalls[0]!.name).toBe('web_search');
    });

    it('툴콜이 없으면 본문을 그대로 둔다', () => {
        const r = stripPseudoToolCalls('평범한 답변입니다.');
        expect(r.content).toBe('평범한 답변입니다.');
        expect(r.toolCalls).toEqual([]);
    });
});
