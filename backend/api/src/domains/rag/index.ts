export { RAGService, getRAGService, reciprocalRankFusion } from './RAGService';
export type { DocumentEmbedRequest, DocumentEmbedResult, RAGSearchRequest } from './RAGService';

export { EmbeddingService, getEmbeddingService } from './EmbeddingService';
export type { EmbeddingResult } from './EmbeddingService';

export { Reranker, getReranker, buildRerankPrompt, parseScore } from './Reranker';
export type { RerankerConfig } from './Reranker';

export {
  calculateNDCG,
  calculateMRR,
  calculateContextPrecision,
  calculateContextRecall,
  evaluateRelevance,
  evaluateQuery,
  generateReport,
  BASELINE_QUERIES,
} from './rag-metrics';
export type { EvalQuery, SearchResult, QueryEvalResult, EvalReport } from './rag-metrics';

export { assessTextQuality, isTextQualityAcceptable, assessAndGate } from './OCRQualityGate';
export type { TextQualityMetrics, QualityThresholds, QualityAssessment } from './OCRQualityGate';
