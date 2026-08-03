/**
 * ============================================================
 * Pseudo Tool Call Parser — 텍스트로 새어나온 툴콜의 차단 + 복구
 * ============================================================
 *
 * vLLM 은 요청에 `tools` 가 없으면 `--tool-call-parser` 를 적용하지 않는다.
 * 이때 모델(Qwen3.6 등)이 학습된 XML 툴콜 포맷을 출력하면 파싱되지 않고
 * `delta.content` 로 그대로 흘러나온다 — 사용자 화면에 원문이 노출되고,
 * 도구는 실행되지 않아 그 턴의 답변 자체가 사라진다.
 *
 *   <tool_call>
 *   <function=web_search>
 *   <parameter=query>
 *   코스피 지수 종가
 *   </parameter>
 *   </function>
 *   </tool_call>
 *
 * 본 모듈은 `reasoning-tag-parser`(`<think>` 누수) 와 같은 계층의 안전망이다:
 *   - `PseudoToolCallGate` : 스트리밍 중 `<tool_call>` 이후 토큰을 사용자에게 방출하지 않고 캡처
 *   - `parsePseudoToolCalls` : 캡처분을 실제 tool call 로 복구 (실행 경로로 승격)
 *
 * 파싱에 실패한 캡처분은 본문으로 되돌리지 않고 폐기한다 — 원문 노출 차단이
 * 이 안전망의 1차 목적이며, 본문이 비면 상위 external-provider 의 빈 응답
 * 방어(도구 끈 최종 턴 재시도)가 답변을 확보한다.
 *
 * @module llm/pseudo-tool-call-parser
 */

/** 툴콜 블록 시작 태그 — Qwen/Hermes 계열 공통. */
const OPEN_TAG = '<tool_call>';

/** `<function=NAME> ... </function>` (닫는 태그 없이 스트림이 끝난 경우도 수용). */
const FUNCTION_BLOCK = /<function=([^>\s]+)\s*>([\s\S]*?)(?:<\/function>|$)/g;

/** `<parameter=NAME> ... </parameter>` (닫는 태그 없이 끝난 경우도 수용). */
const PARAMETER_BLOCK = /<parameter=([^>\s]+)\s*>([\s\S]*?)(?:<\/parameter>|$)/g;

export interface ParsedPseudoToolCall {
    id: string;
    name: string;
    args: Record<string, unknown>;
}

/**
 * 파라미터 값 캐스팅. 텍스트 툴콜은 스키마 정보가 없으므로 JSON 리터럴로
 * 읽히는 값만 변환하고, 그 외에는 문자열로 둔다.
 */
function coerceParamValue(raw: string): unknown {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const looksJson = /^(true|false|null|-?\d+(\.\d+)?)$/.test(trimmed)
        || (trimmed.startsWith('{') && trimmed.endsWith('}'))
        || (trimmed.startsWith('[') && trimmed.endsWith(']'));
    if (looksJson) {
        try { return JSON.parse(trimmed); } catch { return trimmed; }
    }
    return trimmed;
}

/**
 * 캡처된 원문에서 텍스트 툴콜을 추출한다.
 *
 * @param raw - `<tool_call>` 부터 스트림 끝까지의 원문
 * @returns 복구된 tool call 목록 (없으면 빈 배열)
 */
export function parsePseudoToolCalls(raw: string): ParsedPseudoToolCall[] {
    if (!raw) return [];
    const calls: ParsedPseudoToolCall[] = [];
    FUNCTION_BLOCK.lastIndex = 0;
    for (const fnMatch of raw.matchAll(FUNCTION_BLOCK)) {
        const name = fnMatch[1]?.trim();
        if (!name) continue;
        const args: Record<string, unknown> = {};
        for (const paramMatch of (fnMatch[2] ?? '').matchAll(PARAMETER_BLOCK)) {
            const key = paramMatch[1]?.trim();
            if (key) args[key] = coerceParamValue(paramMatch[2] ?? '');
        }
        calls.push({ id: `pseudo_call_${calls.length}`, name, args });
    }
    return calls;
}

/**
 * 비스트리밍 응답용 — 완성된 content 에서 툴콜 블록을 떼어낸다.
 *
 * 스트리밍 게이트와 같은 원칙: 복구에 실패한 블록도 본문으로 되돌리지 않는다.
 *
 * @returns content - 툴콜 블록을 제거한 본문
 *          toolCalls - 복구된 tool call (없으면 빈 배열)
 *          unparsedRaw - 제거했으나 복구에 실패한 원문 (관측용)
 */
export function stripPseudoToolCalls(content: string): {
    content: string;
    toolCalls: ParsedPseudoToolCall[];
    unparsedRaw?: string;
} {
    const openIdx = content.indexOf(OPEN_TAG);
    if (openIdx < 0) return { content, toolCalls: [] };
    const raw = content.slice(openIdx);
    const stripped = content.slice(0, openIdx).trim();
    const toolCalls = parsePseudoToolCalls(raw);
    return toolCalls.length > 0
        ? { content: stripped, toolCalls }
        : { content: stripped, toolCalls: [], unparsedRaw: raw };
}

/**
 * 스트리밍 content 게이트.
 *
 * `feed()` 는 사용자에게 방출해도 되는 텍스트만 돌려주고, `<tool_call>` 이후는
 * 전량 내부 버퍼에 캡처한다. 태그가 청크 경계에 걸쳐 쪼개져 도착하는 경우를
 * 위해 여는 태그의 prefix 와 일치하는 꼬리는 다음 청크까지 방출을 유보한다.
 */
export class PseudoToolCallGate {
    /** 부분 태그일 수 있어 방출을 유보한 꼬리. */
    private tail = '';
    /** `<tool_call>` 감지 이후 캡처한 원문 (null = 아직 감지 전). */
    private captured: string | null = null;

    /** 이미 툴콜 블록을 캡처 중인지 여부. */
    get isCapturing(): boolean {
        return this.captured !== null;
    }

    /**
     * content 델타를 넣고, 사용자에게 방출해도 되는 부분만 돌려받는다.
     */
    feed(delta: string): string {
        if (!delta) return '';
        if (this.captured !== null) {
            this.captured += delta;
            return '';
        }
        const buf = this.tail + delta;
        const openIdx = buf.indexOf(OPEN_TAG);
        if (openIdx >= 0) {
            this.tail = '';
            this.captured = buf.slice(openIdx);
            return buf.slice(0, openIdx);
        }
        const partial = partialOpenTagLength(buf);
        this.tail = partial > 0 ? buf.slice(buf.length - partial) : '';
        return partial > 0 ? buf.slice(0, buf.length - partial) : buf;
    }

    /**
     * 스트림 종료 처리.
     *
     * @returns emit - 유보했던 꼬리 중 방출할 잔량 (부분 태그가 아니었던 경우)
     *          toolCalls - 캡처분에서 복구한 tool call
     *          unparsedRaw - 캡처는 했으나 복구에 실패한 원문 (관측용, 본문 미방출)
     */
    flush(): { emit: string; toolCalls: ParsedPseudoToolCall[]; unparsedRaw?: string } {
        if (this.captured !== null) {
            const raw = this.captured;
            this.captured = null;
            const toolCalls = parsePseudoToolCalls(raw);
            return toolCalls.length > 0
                ? { emit: '', toolCalls }
                : { emit: '', toolCalls: [], unparsedRaw: raw };
        }
        const emit = this.tail;
        this.tail = '';
        return { emit, toolCalls: [] };
    }
}

/** buf 의 꼬리가 OPEN_TAG 의 prefix 와 일치하는 최대 길이 (없으면 0). */
function partialOpenTagLength(buf: string): number {
    const max = Math.min(buf.length, OPEN_TAG.length - 1);
    for (let k = max; k > 0; k--) {
        if (buf.endsWith(OPEN_TAG.slice(0, k))) return k;
    }
    return 0;
}
