/**
 * 컨텍스트 접기(compaction) 훅 (F13.5) — `context-fold.foldOldToolResults` 가 접은 뒤 1회 호출.
 * 관측·메모 추출 같은 부수 작업용. 예외는 fail-open. 코드 등록만(스크립트 로드 없음).
 * @module services/agent-task/compaction-hooks
 */
import type { ChatMessage } from '../../llm/types';
import { createLogger } from '../../utils/logger';

const logger = createLogger('CompactionHooks');

export interface CompactionEvent {
    /** 접힌 뒤의 대화(제자리 수정됨) */
    conversation: ChatMessage[];
    folded: number;
    savedChars: number;
}
export type CompactionHook = (ev: CompactionEvent) => void;

const hooks = new Map<string, CompactionHook>();

export function registerCompactionHook(id: string, hook: CompactionHook): () => void {
    hooks.set(id, hook);
    return () => { hooks.delete(id); };
}

export function runCompactionHooks(ev: CompactionEvent): void {
    for (const [id, h] of hooks) {
        try { h(ev); } catch (e) {
            logger.warn(`compaction 훅 예외 (무시) id=${id}: ${e instanceof Error ? e.message : e}`);
        }
    }
}

/** 테스트 전용 */
export function __resetCompactionHooksForTest(): void { hooks.clear(); }
