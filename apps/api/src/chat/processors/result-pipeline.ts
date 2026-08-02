/**
 * @module chat/processors/result-pipeline
 * @description 응답 본문 후처리 파이프라인 (2026-08-02).
 *
 * 배경: 응답 가공 로직이 파일 5개(artifact-parser·pseudo-tool-call-parser·cot-extractor·
 * reasoning-tag-parser·script-purity)와 여러 인라인 블록(웹검색 출처·지도 블록·이미지
 * 마크다운 첨부)에 흩어져 있고, 실행 순서가 각 호출부에 하드코딩돼 있었다. 새 가공을
 * 하나 추가할 때마다 배선 위치를 찾아 넣어야 했고, 로컬·외부 경로에 같은 배선을 대칭으로
 * 두 번 넣는 일이 반복됐다(2026-08-02 툴콜 안전망·언어 교정 작업에서 실제로 발생).
 *
 * 그래서 **완성된 본문을 받아 본문을 돌려주는** 후처리만 하나의 계약으로 모은다.
 * 스트리밍 중 동작하는 가공(아티팩트 파서·think 분리·툴콜 게이트)은 각자 반환 구조가
 * 달라(툴콜 복구·thinking 분리·아티팩트 이벤트) 억지로 묶으면 추상화 비용이 이득을
 * 넘어서므로 **의도적으로 제외**한다.
 *
 * 계약:
 *  - `process()` 가 `null` 을 돌려주면 "변경 없음" — 원문을 유지한다.
 *  - 예외를 던져도 파이프라인이 삼키고 원문으로 계속한다(**fail-open**). 후처리 실패가
 *    본 응답을 죽이면 안 된다는 원칙은 개별 프로세서가 아니라 여기서 보장한다.
 */
import { createLogger } from '../../utils/logger';

const logger = createLogger('ResultPipeline');

/** 결과 프로세서에 전달되는 요청 맥락. */
export interface ResultProcessorCtx {
    /** resolvedLanguage — 언어 의존 가공(스크립트 순수성 등)이 사용. */
    langCode?: string | undefined;
    /** role client 해석 등에 사용. */
    userId?: string | undefined;
}

/** 완성된 본문을 받아 가공본을 돌려주는 후처리 단위. */
export interface ResultProcessor {
    readonly id: string;
    /**
     * @returns 가공된 본문. **변경이 없으면 `null`** (원문 유지).
     */
    process(content: string, ctx: ResultProcessorCtx): Promise<string | null>;
}

/**
 * 프로세서를 배열 순서대로 적용한다. 앞선 프로세서의 결과가 다음 입력이 된다.
 *
 * @returns content - 최종 본문, applied - 실제로 본문을 바꾼 프로세서 id 목록(관측용)
 */
export async function runResultProcessors(
    content: string,
    ctx: ResultProcessorCtx,
    processors: readonly ResultProcessor[],
): Promise<{ content: string; applied: string[] }> {
    let current = content;
    const applied: string[] = [];
    for (const p of processors) {
        try {
            const next = await p.process(current, ctx);
            if (next !== null && next !== current) {
                current = next;
                applied.push(p.id);
            }
        } catch (e) {
            // fail-open — 후처리 실패가 본 응답을 훼손하지 않는다.
            logger.warn(`[${p.id}] 후처리 실패, 원문 유지: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    return { content: current, applied };
}
