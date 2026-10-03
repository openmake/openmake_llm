/**
 * 도구 결과 절단 — 상한을 넘는 결과의 앞·뒤를 남기고 가운데를 생략한다.
 *
 * 종전에는 앞부분만 남기고(표시 없이) 잘라, 셸 결과의 stderr·종료 코드 줄과 서브에이전트 결과 끝의
 * 종합 안내가 모델에 가지 않았다. 끝부분을 남기고, 잘렸다는 사실과 생략된 글자 수를 알린다.
 *
 * ⚠️ 표시에 "다시 호출하세요" 류 안내를 넣지 않는다 — 접힌 결과에서 그 문구가 같은 파일을 반복해
 * 읽는 루프를 만들었다(context-fold.ts 의 2026-09-09 기록).
 *
 * @module services/agent-task/tool-result-truncate
 */

/** PURE: 생략 표시 — 생략된 글자 수와 원문 전체 길이. */
function omissionMarker(omitted: number, total: number): string {
    return `...[가운데 ${omitted}자 생략 — 전체 ${total}자]...`;
}

/**
 * PURE: text 가 cap 을 넘으면 앞 cap×headRatio 자와 나머지 뒤쪽을 남긴다(표시는 cap 에 포함하지 않는다).
 * headRatio 는 0~1 로 맞춘다.
 */
export function truncateToolResult(text: string, cap: number, headRatio: number): string {
    if (text.length <= cap) return text;
    const ratio = Math.min(1, Math.max(0, headRatio));
    const head = Math.floor(cap * ratio);
    const tail = cap - head;
    const marker = omissionMarker(text.length - cap, text.length);
    return [text.slice(0, head), marker, tail > 0 ? text.slice(-tail) : ''].filter((p) => p.length > 0).join('\n');
}
