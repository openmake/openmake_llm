/**
 * @module chat/processors
 * @description 채팅 응답 후처리 프로세서 등록부.
 *
 * **새 후처리를 추가할 때는 이 배열에 한 줄만 넣으면 된다** — 호출부(message-pipeline)를
 * 고칠 필요가 없다. 순서가 곧 실행 순서다.
 */
import { repairScriptMixing } from '../../services/chat-service/script-purity';
import type { ResultProcessor } from './result-pipeline';

/**
 * 스크립트 순수성 — 검색·도구 결과 언어에 끌려 한글 문장에 섞인 한자·가나를 교정한다.
 * 혼입이 없으면 LLM 을 호출하지 않고 즉시 null(변경 없음)을 돌려준다.
 */
const scriptPurity: ResultProcessor = {
    id: 'script-purity',
    process: (content, ctx) => repairScriptMixing(content, ctx.langCode, ctx.userId),
};

/** 채팅 응답 후처리 체인 (배열 순서 = 실행 순서). */
export const CHAT_RESULT_PROCESSORS: readonly ResultProcessor[] = [
    scriptPurity,
];

export { runResultProcessors } from './result-pipeline';
export type { ResultProcessor, ResultProcessorCtx } from './result-pipeline';
