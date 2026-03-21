/**
 * ============================================================
 * Deep Research Module — 통합 진입점 (Barrel)
 * ============================================================
 *
 * Deep Research 관련 서비스, 타입, 유틸리티를 단일 경로로
 * import할 수 있도록 re-export합니다.
 *
 * @example
 * import { DeepResearchService, type ResearchConfig, normalizeUrl } from '../services/deep-research';
 *
 * @module services/deep-research
 */

// ── Service ──────────────────────────────────────────
export {
    DeepResearchService,
    createDeepResearchService,
    quickResearch,
    getResearchConfig,
    configureResearch,
} from '../DeepResearchService';

// ── Types ────────────────────────────────────────────
export type {
    ResearchConfig,
    ResearchProgress,
    ResearchResult,
    SubTopic,
    SynthesisResult,
} from '../deep-research-types';

export {
    DEFAULT_CONFIG as RESEARCH_DEFAULT_CONFIG,
    setGlobalConfig as setResearchGlobalConfig,
} from '../deep-research-types';

// ── Utilities ────────────────────────────────────────
export {
    normalizeUrl,
    deduplicateSources,
    clampImportance,
    buildFallbackSubTopics,
    chunkArray,
    extractBulletLikeFindings,
    getLoopProgressRange,
} from '../deep-research-utils';

// ── Pipeline stages ──────────────────────────────────
export { decomposeTopics } from './topic-decomposer';
export { searchSubTopics } from './source-searcher';
export { scrapeSources, scrapeSingleUrl } from './content-scraper';
export { synthesizeFindings, checkNeedsMoreInfo } from './findings-synthesizer';
export { generateReport } from './report-generator';
