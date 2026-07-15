/**
 * ============================================================
 * DeepResearchStrategy - 심층 연구 오케스트레이션 전략
 * ============================================================
 *
 * 사용자 질문에 대해 자율적 다단계 리서치를 수행하여
 * 주제 분해, 웹 검색, 소스 수집, 종합 보고서를 생성합니다.
 *
 * @module services/chat-strategies/deep-research-strategy
 * @description
 * - DeepResearchService를 통한 자율적 다단계 리서치 실행
 * - 연구 세션 DB 저장 (추후 조회/이어하기 지원)
 * - 결과 포맷팅 및 문자 단위 스트리밍 전송
 * - 최대 5 루프, 360개 검색 결과, 80개 소스, 15개/루프 스크래핑 설정
 */
import { v4 as uuidv4 } from 'uuid';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { DeepResearchService, type ResearchResult } from '../DeepResearchService';
import type { ChatStrategy, ChatResult, DeepResearchStrategyContext } from './types';
import { createLogger } from '../../utils/logger';
import { isPersistableUserId } from '../../utils/user-id-validation';
import { detectLanguage } from '../../chat/language-policy';
import { LLM_TIMEOUTS } from '../../config/timeouts';
import { RESEARCH_STRATEGY_PARAMS } from '../../config/runtime-limits';
import { sanitizePromptInput } from '../../utils/input-sanitizer';

const logger = createLogger('DeepResearchStrategy');

/**
 * 심층 연구 오케스트레이션 전략
 *
 * DeepResearchService를 생성하여 연구를 수행하고,
 * 연구 세션을 DB에 저장한 후 포맷팅된 보고서를 스트리밍합니다.
 *
 * @class DeepResearchStrategy
 * @implements {ChatStrategy<DeepResearchStrategyContext, ChatResult>}
 */
export class DeepResearchStrategy implements ChatStrategy<DeepResearchStrategyContext, ChatResult> {
    /**
     * 심층 연구를 실행합니다.
     *
     * 실행 흐름:
     * 1. DeepResearchService 인스턴스 생성 (연구 파라미터 설정)
     * 2. UUID 세션 ID 생성 및 DB에 연구 세션 저장
     * 3. 연구 실행 (주제 분해 → 웹 검색 → 소스 수집 → 분석 → 보고서)
     * 4. 결과 포맷팅 및 문자 단위 스트리밍 전송
     *
     * @param context - 심층 연구 컨텍스트 (요청, 클라이언트, 진행 콜백, 포맷터)
     * @returns 포맷팅된 연구 보고서 응답
     */
    async execute(context: DeepResearchStrategyContext): Promise<ChatResult> {
        const { message: rawMessage, userId } = context.req;
        const message = sanitizePromptInput(rawMessage);

        logger.info('🔬 Deep Research 모드 시작');

        // 사용자 메시지에서 언어 감지 후 연구 서비스 생성.
        // context.client 를 직접 주입 — 외부 모델 선택 시 그 BYOK 클라이언트로 리서치 전 단계
        // 수행(로컬은 svc.client 로 기존과 동일). 모델명만 넘기면 내부에서 로컬 client 를
        // 재생성해 외부 모델이 로컬 endpoint 로 404 나던 문제 해소.
        const researchService = new DeepResearchService({
            maxLoops: RESEARCH_STRATEGY_PARAMS.MAX_LOOPS,
            searchApi: RESEARCH_STRATEGY_PARAMS.SEARCH_API,
            maxSearchResults: RESEARCH_STRATEGY_PARAMS.MAX_SEARCH_RESULTS,
            language: detectLanguage(message).language,
            maxTotalSources: RESEARCH_STRATEGY_PARAMS.MAX_TOTAL_SOURCES,
            scrapeFullContent: RESEARCH_STRATEGY_PARAMS.SCRAPE_FULL_CONTENT,
            maxScrapePerLoop: RESEARCH_STRATEGY_PARAMS.MAX_SCRAPE_PER_LOOP,
            scrapeTimeoutMs: LLM_TIMEOUTS.SCRAPE_TIMEOUT_MS,
            chunkSize: RESEARCH_STRATEGY_PARAMS.CHUNK_SIZE,
        }, context.client);

        // 연구 세션 ID 생성 및 DB 저장 (추후 조회/이어하기용)
        const sessionId = uuidv4();

        const db = getUnifiedDatabase();
        await db.createResearchSession({
            id: sessionId,
            userId: isPersistableUserId(userId) ? userId : undefined,
            topic: message,
            depth: 'deep',
        });

        // 연구 실행 및 결과 포맷팅
        // result 는 try 밖에 보존 — executeResearch 성공(보고서 완성) 후 스트리밍 단계에서
        // 중단/오류가 나도 completed 세션을 failed 로 덮어쓰지 않기 위함.
        let result: ResearchResult | undefined;
        try {
            result = await researchService.executeResearch(sessionId, message, context.onProgress, context.req.abortSignal);
            const formattedResponse = context.formatResearchResult(result);

            // 포맷팅된 보고서를 문자 단위로 스트리밍 전송
            for (const char of formattedResponse) {
                context.onToken(char);
            }

            logger.info(`🔬 Deep Research 완료: ${result.duration}ms, ${result.totalSteps} 단계`);

            return { response: formattedResponse };
        } catch (error) {
            // executeResearch 가 보고서를 완성한 뒤(result 존재) 스트리밍 단계에서 중단/오류가 난 경우:
            // 보고서는 이미 completed 로 DB 에 저장돼 있으므로 failed 로 덮어쓰지 않는다.
            // (장시간 연구 중 사용자가 다른 대화로 전환 → WS 스트리밍 abort 시 결과 유실 방지)
            if (result) {
                logger.info('🔬 Deep Research 보고서 완성 후 스트리밍 중단 — completed 유지');
                const formattedResponse = context.formatResearchResult(result);
                try { for (const char of formattedResponse) context.onToken(char); } catch { /* 연결 종료 무시 */ }
                return { response: formattedResponse };
            }

            const isAborted = error instanceof Error && error.message === 'RESEARCH_ABORTED';
            if (isAborted) {
                logger.info('🔬 Deep Research 사용자 취소');
            } else {
                logger.warn(`🔬 Deep Research 실패: ${error instanceof Error ? error.message : String(error)}`);
            }

            await db.updateResearchSession(sessionId, {
                status: isAborted ? 'cancelled' : 'failed',
            }).catch(dbErr => logger.warn(`세션 상태 업데이트 실패: ${dbErr}`));

            const fallbackResponse = isAborted
                ? '연구가 취소되었습니다.'
                : '연구 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';

            try { for (const char of fallbackResponse) context.onToken(char); } catch { /* 연결 종료 무시 */ }

            return { response: fallbackResponse };
        }
    }
}
