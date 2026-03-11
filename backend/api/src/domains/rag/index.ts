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

// Documents (consolidated from top-level documents/)
export * from './documents';
export { uploadedDocuments } from './documents/store';
export type { DocumentStore } from './documents/store';
export { chunkDocument, chunkText } from './documents/chunker';
export type { TextChunk, ChunkOptions, ChunkMetadata } from './documents/chunker';
