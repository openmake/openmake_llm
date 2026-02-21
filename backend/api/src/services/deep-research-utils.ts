/**
 * ============================================================
 * Deep Research Utility Functions
 * ============================================================
 *
 * Pure utility functions extracted from DeepResearchService.
 * These operate only on their parameters with no instance state.
 *
 * @module services/deep-research-utils
 */

import type { SearchResult } from '../mcp/web-search';
import type { SubTopic } from './deep-research-types';

/**
 * 중복 소스 제거
 */
export function deduplicateSources(sources: SearchResult[]): SearchResult[] {
    const seen = new Set<string>();
    return sources.filter(source => {
        const normalized = normalizeUrl(source.url);
        if (seen.has(normalized)) {
            return false;
        }
        seen.add(normalized);
        return true;
    });
}

export function normalizeUrl(url: string): string {
    return url
        .trim()
        .replace(/\/$/, '')
        .replace(/^https?:\/\//, '')
        .toLowerCase();
}

export function clampImportance(value: number | undefined): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return 3;
    }
    return Math.max(1, Math.min(5, Math.round(value)));
}

export function buildFallbackSubTopics(topic: string): SubTopic[] {
    return [
        {
            title: `${topic} 개요 및 정의`,
            searchQueries: [`${topic} 개요`, `${topic} 정의`, `${topic} 배경`],
            importance: 5
        },
        {
            title: `${topic} 최신 동향`,
            searchQueries: [`${topic} 최신 동향`, `${topic} 2025 트렌드`, `${topic} recent updates`],
            importance: 5
        },
        {
            title: `${topic} 기술/구조 분석`,
            searchQueries: [`${topic} 구조`, `${topic} architecture`, `${topic} technical analysis`],
            importance: 4
        },
        {
            title: `${topic} 시장 및 산업 영향`,
            searchQueries: [`${topic} 시장 규모`, `${topic} 산업 영향`, `${topic} market report`],
            importance: 4
        },
        {
            title: `${topic} 주요 사례`,
            searchQueries: [`${topic} 사례`, `${topic} case study`, `${topic} 성공 사례`],
            importance: 4
        },
        {
            title: `${topic} 리스크와 한계`,
            searchQueries: [`${topic} 한계`, `${topic} 리스크`, `${topic} 문제점`],
            importance: 3
        },
        {
            title: `${topic} 규제 및 정책`,
            searchQueries: [`${topic} 규제`, `${topic} 정책`, `${topic} 법률`],
            importance: 3
        },
        {
            title: `${topic} 향후 전망`,
            searchQueries: [`${topic} 전망`, `${topic} future outlook`, `${topic} 예측`],
            importance: 3
        }
    ];
}

export function chunkArray<T>(items: T[], chunkSize: number): T[][] {
    const safeChunkSize = Math.max(1, chunkSize);
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += safeChunkSize) {
        chunks.push(items.slice(i, i + safeChunkSize));
    }
    return chunks;
}

export function extractBulletLikeFindings(text: string): string[] {
    return text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('- ') || /^\d+\./.test(line))
        .map(line => line.replace(/^[-\d.\s]+/, '').trim())
        .filter(line => line.length > 0)
        .slice(0, 20);
}

export function getLoopProgressRange(loopIndex: number, maxLoops: number): {
    searchStart: number;
    searchEnd: number;
    scrapeStart: number;
    scrapeEnd: number;
    synthStart: number;
    synthesizeStart: number;
    synthesizeEnd: number;
} {
    const loopSpan = 80 / maxLoops;
    const loopBase = 5 + (loopIndex * loopSpan);
    const searchEnd = loopBase + (loopSpan / 3);
    const scrapeEnd = loopBase + ((loopSpan / 3) * 2);
    const synthEnd = loopBase + loopSpan;

    return {
        searchStart: loopBase,
        searchEnd,
        scrapeStart: searchEnd,
        scrapeEnd,
        synthStart: scrapeEnd,
        synthesizeStart: scrapeEnd,
        synthesizeEnd: synthEnd
    };
}
