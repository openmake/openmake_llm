import { v4 as uuidv4 } from 'uuid';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { DeepResearchService } from '../DeepResearchService';
import type { ChatStrategy, ChatResult, DeepResearchStrategyContext } from './types';

export class DeepResearchStrategy implements ChatStrategy<DeepResearchStrategyContext, ChatResult> {
    async execute(context: DeepResearchStrategyContext): Promise<ChatResult> {
        const { message, userId } = context.req;

        console.log('[ChatService] 🔬 Deep Research 모드 시작');

        const researchService = new DeepResearchService({
            maxLoops: 5,
            llmModel: context.client.model,
            searchApi: 'all',
            maxSearchResults: 360,
            language: 'ko',
            maxTotalSources: 80,
            scrapeFullContent: true,
            maxScrapePerLoop: 15,
            scrapeTimeoutMs: 15000,
            chunkSize: 10,
        });

        const sessionId = uuidv4();

        const db = getUnifiedDatabase();
        await db.createResearchSession({
            id: sessionId,
            userId: userId && userId !== 'guest' && !userId.startsWith('anon-') ? userId : undefined,
            topic: message,
            depth: 'deep',
        });

        const result = await researchService.executeResearch(sessionId, message, context.onProgress);
        const formattedResponse = context.formatResearchResult(result);

        for (const char of formattedResponse) {
            context.onToken(char);
        }

        console.log(`[ChatService] 🔬 Deep Research 완료: ${result.duration}ms, ${result.totalSteps} 단계`);

        return { response: formattedResponse };
    }
}
