/**
 * Web Search Routes
 * 웹 검색 API 라우트
 * 
 * - POST /web-search - 웹 검색 + LLM 사실 검증
 */

import { Router, Request, Response } from 'express';
import { ClusterManager } from '../cluster/manager';
import { OllamaClient } from '../ollama/client';
import { getConfig } from '../config';
import { success, badRequest, internalError, serviceUnavailable } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { createLogger } from '../utils/logger';

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
router.post('/web-search', asyncHandler(async (req: Request, res: Response) => {
     const { query } = req.body;
     if (!query || typeof query !== 'string' || query.trim().length === 0) {
         return res.status(400).json(badRequest('query는 필수입니다'));
     }
     const requestedModel = req.body.model;
     const model = (!requestedModel || requestedModel === 'default')
         ? envConfig.ollamaDefaultModel
         : requestedModel;

      logger.info(`[WebSearch] 쿼리: ${query?.substring(0, 50)}... (모델: ${model})`);

     // 1. 실제 웹 검색 수행
     const { performWebSearch } = await import('../mcp');
     const searchResults = await performWebSearch(query, { maxResults: 5 });

      logger.info(`[WebSearch] ${searchResults.length}개 결과 찾음`);

      // Cloud 모델 처리
      let client: OllamaClient | undefined;
      const isCloudModel = model?.toLowerCase().endsWith(':cloud');

      if (isCloudModel) {
          const { createClient } = await import('../ollama/client');
          client = createClient({ model });
           logger.info(`[WebSearch] Cloud 클라이언트 생성: ${model}`);
      } else {
          const bestNode = clusterManager.getBestNode(model);
          client = bestNode ? clusterManager.createScopedClient(bestNode.id, model) : undefined;
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

     const searchPrompt = `다음 질문에 대해 웹 검색 결과를 참고하여 정확하게 답변해주세요.

## 질문
${query}

## 웹 검색 결과 (${new Date().toLocaleDateString('ko-KR')} 기준)
${sourcesContext}

## 답변 지침
1. 검색 결과를 기반으로 최신 정보를 제공하세요
2. 출처가 있을 경우 [출처 N] 형식으로 인용하세요
3. 정보가 불확실한 경우 명시하세요
4. 한국어로 답변하세요

## 답변:`;

      logger.info('[WebSearch] LLM에 사실 검증 요청...');
     const result = await client.generate(searchPrompt, {
         temperature: 0.3,
         num_ctx: 8192
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
