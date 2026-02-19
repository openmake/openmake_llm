/**
 * ============================================================
 * Deep Research Types & Configuration
 * ============================================================
 *
 * Type definitions and default configuration for DeepResearchService.
 *
 * @module services/deep-research-types
 */

import type { SearchResult } from '../mcp/web-search';

// ============================================================
// 타입 정의
// ============================================================

/** 리서치 설정 */
export interface ResearchConfig {
    maxLoops: number;            // 최대 반복 횟수 (기본: 5)
    llmModel: string;            // 사용할 LLM 모델
    searchApi: 'ollama' | 'firecrawl' | 'google' | 'all'; // 검색 API
    maxSearchResults: number;    // 검색 결과 예산 (기본: 360)
    language: 'ko' | 'en';       // 출력 언어
    maxTotalSources: number;     // 목표 고유 소스 수 (기본: 80)
    scrapeFullContent: boolean;  // Firecrawl로 풀 콘텐츠 스크래핑 여부 (기본: true)
    maxScrapePerLoop: number;    // 루프당 최대 스크래핑 수 (기본: 15)
    scrapeTimeoutMs: number;     // 개별 스크래핑 타임아웃 (기본: 15000)
    chunkSize: number;           // 중간 요약용 청크 사이즈 (기본: 10)
}

/** 리서치 진행 상황 */
export interface ResearchProgress {
    sessionId: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    currentLoop: number;
    totalLoops: number;
    currentStep: string;
    progress: number; // 0-100
    message: string;
}

/** 리서치 결과 */
export interface ResearchResult {
    sessionId: string;
    topic: string;
    summary: string;
    keyFindings: string[];
    sources: SearchResult[];
    totalSteps: number;
    duration: number; // ms
}

/** 서브 토픽 */
export interface SubTopic {
    title: string;
    searchQueries: string[];
    importance: number; // 1-5
}

export interface SynthesisResult {
    summary: string;
    keyPoints: string[];
}

// ============================================================
// 기본 설정
// ============================================================

export const DEFAULT_CONFIG: ResearchConfig = {
    maxLoops: 5,
    llmModel: 'gemma3:4b',
    searchApi: 'all',
    maxSearchResults: 360,
    language: 'ko',
    maxTotalSources: 80,
    scrapeFullContent: true,
    maxScrapePerLoop: 15,
    scrapeTimeoutMs: 15000,
    chunkSize: 10
};

// 전역 설정 (configure로 변경 가능)
export let globalConfig: ResearchConfig = { ...DEFAULT_CONFIG };

/**
 * Update the global config reference.
 * Used by configureResearch() in DeepResearchService.
 */
export function setGlobalConfig(config: ResearchConfig): void {
    globalConfig = config;
}
