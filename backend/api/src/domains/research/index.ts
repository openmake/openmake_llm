/**
 * ============================================================
 * Deep Research Domain — Barrel
 * ============================================================
 *
 * Re-exports the Deep Research service, types, and utilities
 * from a single import path.
 *
 * @example
 * import { DeepResearchService, type ResearchConfig, normalizeUrl } from '../../domains/research';
 *
 * @module domains/research
 */

// ── Service ──────────────────────────────────────────
export {
    DeepResearchService,
    createDeepResearchService,
    quickResearch,
    getResearchConfig,
    configureResearch,
} from './DeepResearchService';

// ── Types ────────────────────────────────────────────
export type {
    ResearchConfig,
    ResearchProgress,
    ResearchResult,
    SubTopic,
    SynthesisResult,
} from './deep-research-types';

export {
    DEFAULT_CONFIG as RESEARCH_DEFAULT_CONFIG,
    setGlobalConfig as setResearchGlobalConfig,
} from './deep-research-types';

// ── Utilities ────────────────────────────────────────
export {
    normalizeUrl,
    deduplicateSources,
    clampImportance,
    buildFallbackSubTopics,
    chunkArray,
    extractBulletLikeFindings,
    getLoopProgressRange,
<<<<<<< HEAD:backend/api/src/domains/research/index.ts
} from './deep-research-utils';
=======
} from '../deep-research-utils';

// ── Pipeline stages ──────────────────────────────────
export { decomposeTopics } from './topic-decomposer';
export { searchSubTopics } from './source-searcher';
export { scrapeSources, scrapeSingleUrl } from './content-scraper';
export { synthesizeFindings, checkNeedsMoreInfo } from './findings-synthesizer';
export { generateReport } from './report-generator';
>>>>>>> fbe49389978ecfeb4fc6d2df399c18138a7fed78:backend/api/src/services/deep-research/index.ts
