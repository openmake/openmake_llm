/**
 * 중단(abort)으로 끝난 스트림 처리 — stream-parser 보조 (파일 크기 가드로 분리).
 *
 * signal 이 중단되면 스트림은 끝난 것처럼 빠져나오므로, 그때의 tool call 버퍼는 잘린 인자일 수 있다.
 * 깨진 호출이 {} 인자로 강등돼 실제 실행되지 않도록 호출부는 tool call(텍스트 툴콜 복구 포함)을
 * 버리고, 결과에 `aborted: true` 만 표시한다.
 *
 * @module llm/stream-abort
 */
import { createLogger } from '../utils/logger';

const log = createLogger('StreamParser');

/** 스트림이 중단으로 끝났는지 판정 — 중단이면 버릴 부분 tool call 수를 경고로 남긴다. */
export function isAbortedStream(signal: AbortSignal | undefined, pendingToolCalls: number): boolean {
    if (signal?.aborted !== true) return false;
    if (pendingToolCalls > 0) log.warn(`[StreamParser] 중단된 스트림 — 부분 tool call ${pendingToolCalls}건 폐기`);
    return true;
}

/** 중단된 스트림 결과에 `aborted: true` 를 싣는다 — 정상 종료면 결과를 그대로 돌려준다(필드 없음). */
export function markAborted<T extends object>(aborted: boolean, result: T): T & { aborted?: true } {
    return aborted ? { ...result, aborted: true as const } : result;
}
