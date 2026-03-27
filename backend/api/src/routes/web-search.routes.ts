/**
 * ============================================================
 * Web Search Routes - 웹 검색 API 라우트
 * ============================================================
 *
 * Google Custom Search를 통한 실시간 웹 검색 후
 * LLM 기반 사실 검증(fact-checking)을 수행하여 응답합니다.
 * Cloud 모델과 로컬 모델 모두 지원합니다.
 *
 * @module routes/web-search.routes
 * @description
 * - POST /api/web-search - 웹 검색 + LLM 사실 검증 (검색 결과, 출처 포함)
 *
 * @requires ClusterManager - Ollama 클러스터 관리
 * @requires performWebSearch - Google Custom Search 실행
 * @requires OllamaClient - LLM 생성 클라이언트
 */

import { Router, Request, Response } from 'express';
import { ClusterManager } from '../cluster/manager';
import { OllamaClient } from '../ollama/client';
import { getConfig } from '../config';
import { success, serviceUnavailable } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { createLogger } from '../utils/logger';
import { buildExecutionPlan } from '../chat/profile-resolver';
import { requireAuth } from '../auth';
import { validate } from '../middlewares/validation';
import { webSearchSchema } from '../schemas/web-search.schema';
import { CAPACITY } from '../config/runtime-limits';
import { LLM_TEMPERATURES } from '../config/llm-parameters';
import { buildWebSearchPrompt } from '../prompts/web-search-system';

const logger = createLogger('WebSearchRoutes');

const router = Router();
let clusterManager: ClusterManager;

const envConfig = getConfig();

/**
 * 클러스터 매니저 참조 설정
 */
export function setClusterManager(cluster: ClusterManager): void {
    clusterManager = cluster;
}

/**
 * POST /api/web-search
 * 웹 검색 API (실제 인터넷 검색 + 사실 검증)
 */
router.post('/web-search', requireAuth, validate(webSearchSchema), asyncHandler(async (req: Request, res: Response) => {
     const { query, model: requestedModel } = req.body as { query: string; model?: string };
     const model = (!requestedModel || requestedModel === 'default')
         ? envConfig.ollamaDefaultModel
         : requestedModel;

      logger.info(`[WebSearch] 쿼리: ${query?.substring(0, 50)}... (모델: ${model})`);

     // 1. 실제 웹 검색 수행
     const { performWebSearch } = await import('../mcp');
     const searchResults = await performWebSearch(query, { maxResults: 5 });

      logger.info(`[WebSearch] ${searchResults.length}개 결과 찾음`);

      // §9 Pipeline Profile: brand model alias → 실제 엔진 모델 해석
      const wsPlan = buildExecutionPlan(model || '');
      const wsIsAuto = wsPlan.resolvedEngine === '__auto__';
      const wsEngineModel = wsIsAuto ? '' : (wsPlan.resolvedEngine || model);

      // Cloud 모델 처리
      let client: OllamaClient | undefined;
      const lowerEngineModel = wsEngineModel?.toLowerCase() ?? '';
      const isCloudModel = lowerEngineModel.endsWith(':cloud') || lowerEngineModel.endsWith('-cloud');

      if (isCloudModel) {
          const { createClient } = await import('../ollama/client');
          client = createClient({ model: wsEngineModel });
           logger.info(`[WebSearch] Cloud 클라이언트 생성: ${wsEngineModel}`);
      } else {
          if (!clusterManager) {
              res.status(503).json(serviceUnavailable('Cluster manager not initialized'));
              return;
          }
          const bestNode = clusterManager.getBestNode(wsEngineModel);
          client = bestNode ? clusterManager.createScopedClient(bestNode.id, wsEngineModel) : undefined;
      }

      if (!client) {
          res.status(503).json(serviceUnavailable('사용 가능한 노드가 없습니다'));
          return;
      }

     // 2. 검색 결과를 기반으로 LLM에 사실 검증 요청
     const sourcesContext = searchResults.length > 0
         ? searchResults.map((r: { title?: string; url?: string; snippet?: string }, i: number) =>
             `[출처 ${i + 1}] ${r.title}\n   URL: ${r.url}\n   내용: ${r.snippet || '(내용 없음)'}`
         ).join('\n\n')
         : '(검색 결과 없음)';

     const searchPrompt = buildWebSearchPrompt(query, sourcesContext, new Date().toLocaleDateString());

      logger.info('[WebSearch] LLM에 사실 검증 요청...');
     const result = await client.generate(searchPrompt, {
         temperature: LLM_TEMPERATURES.WEB_SEARCH,
          num_ctx: CAPACITY.WEB_SEARCH_NUM_CTX  // Ollama 공식 권장: 웹 검색/에이전트 시 최소 64K 토큰
     });
     const response = result.response;

       logger.info('[WebSearch] 응답 완료');
      res.json(success({
          answer: response,
          sources: searchResults.map((r: { title?: string; url?: string; snippet?: string }) => ({
              title: r.title,
              url: r.url,
              snippet: r.snippet
          })),
          searchDate: new Date().toISOString()
      }));
}));

export default router;
