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
import { getUnifiedDatabase } from '../../../data/models/unified-database';
import { DeepResearchService } from '../../../services/DeepResearchService';
import type { ResearchResult } from '../../../services/deep-research-types';
import type { ChatStrategy, ChatResult, DeepResearchStrategyContext } from './types';
import { createLogger } from '../../../utils/logger';
import { detectLanguage } from '../pipeline/language-policy';
import { LLM_TIMEOUTS } from '../../../config/timeouts';

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
        const { message, userId } = context.req;

        logger.info('🔬 Deep Research 모드 시작');

        // 사용자 메시지에서 언어 감지 후 연구 서비스 생성
        const researchService = new DeepResearchService({
            maxLoops: 5,
            llmModel: context.client.model,
            searchApi: 'all',
            maxSearchResults: 360,
            language: detectLanguage(message).language,
            maxTotalSources: 80,
            scrapeFullContent: true,
            maxScrapePerLoop: 15,
            scrapeTimeoutMs: LLM_TIMEOUTS.SCRAPE_TIMEOUT_MS,
            chunkSize: 10,
        });

        // 연구 세션 ID 생성 및 DB 저장 (추후 조회/이어하기용)
        const sessionId = uuidv4();

        const db = getUnifiedDatabase();
        await db.createResearchSession({
            id: sessionId,
            userId: userId && userId !== 'guest' && !userId.startsWith('anon-') ? userId : undefined,
            topic: message,
            depth: 'deep',
        });

        // 연구 실행 및 결과 포맷팅
        const result = await researchService.executeResearch(sessionId, message, context.onProgress);
        const formattedResponse = context.formatResearchResult(result);

        // 포맷팅된 보고서를 문자 단위로 스트리밍 전송
        for (const char of formattedResponse) {
            context.onToken(char);
        }

        logger.info(`🔬 Deep Research 완료: ${result.duration}ms, ${result.totalSteps} 단계`);

        // RAG 자동 저장 (비동기 — 스트리밍 응답을 차단하지 않음)
        this.saveToRAG(result, userId, sessionId).catch(err => {
            logger.warn(`Deep Research → RAG 저장 실패 (무시): ${err instanceof Error ? err.message : String(err)}`);
        });

        return { response: formattedResponse };
    }

    /**
     * Deep Research 결과를 RAG 벡터 DB에 자동 저장합니다.
     *
     * 보고서 전문(summary + keyFindings + 소스 본문)을 하나의 RAG 문서로 임베딩하여,
     * 동일/유사 주제 후속 질의 시 RAG 검색으로 즉시 활용할 수 있도록 합니다.
     */
    private async saveToRAG(result: ResearchResult, userId?: string, sessionId?: string): Promise<void> {
        const { RAGService } = await import('../../../services/RAGService');
        const ragService = new RAGService();

        // 보고서 전문 구성: summary + keyFindings + 소스 콘텐츠(있는 경우)
        const parts: string[] = [
            `# ${result.topic}`,
            '',
            '## Summary',
            result.summary,
            '',
            '## Key Findings',
            ...result.keyFindings.map((f, i) => `${i + 1}. ${f}`),
        ];

        // 소스에 fullContent가 있으면 포함 (Firecrawl 스크래핑 결과)
        const sourcesWithContent = result.sources.filter(
            s => s.fullContent && s.fullContent.length > 50
        );
        if (sourcesWithContent.length > 0) {
            parts.push('', '## Source Details');
            for (const src of sourcesWithContent.slice(0, 20)) {
                parts.push(`### ${src.title || src.url}`);
                // 소스당 최대 3,000자로 제한하여 전체 문서 크기 관리
                const content = src.fullContent!;
                parts.push(content.length > 3000 ? content.substring(0, 3000) + '...' : content);
                parts.push('');
            }
        }

        const docId = `deep-research-${sessionId || uuidv4()}`;
        const text = parts.join('\n');
        const filename = `deep-research-${result.topic.substring(0, 50).replace(/[^a-zA-Z0-9가-힣\s]/g, '')}.md`;

        await ragService.embedDocument({
            docId,
            text,
            filename,
            userId,
        });

        logger.info(`Deep Research → RAG 저장 완료: ${filename} (${text.length}자, docId=${docId})`);
    }
}
