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
} from './deep-research-utils';
