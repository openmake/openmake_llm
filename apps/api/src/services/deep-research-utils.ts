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
import { cleanSearchQuery } from '../mcp/web-search/query-cleaner';

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

/**
 * URL 에서 등록 도메인(host, www 제거)을 추출. 파싱 불가 시 null.
 */
export function extractDomain(url: string): string | null {
    try {
        const u = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`);
        const host = u.hostname.toLowerCase().replace(/^www\./, '');
        // 등록 도메인은 점을 포함한다. 단일 라벨('garbage' 등)은 URL 파싱은 통과하나 도메인 아님.
        return host.includes('.') ? host : null;
    } catch {
        return null;
    }
}

/** Deep Research 결정적 메트릭 (단계8, LLM 비용 0) */
export interface ResearchMetrics {
    /** 최종 고유 소스 수 */
    sourceCount: number;
    /** 고유 도메인 수 */
    uniqueDomains: number;
    /** 소스 다양성 = uniqueDomains / sourceCount (0..1). 소스 0이면 0 */
    sourceDiversity: number;
    /** 스크래핑된 URL 수 */
    scrapedCount: number;
    /** 실제 실행된 루프 수 */
    loopsExecuted: number;
    /** 전체 소요 시간 (ms) */
    durationMs: number;
}

/**
 * deep-research 실행의 결정적 메트릭 산출 (LLM 비용 0, measure-only).
 * groundedness 등 LLM-judge 메트릭은 별도(단계8 후속) — 여기선 산술 가능한 것만.
 */
export function computeResearchMetrics(params: {
    sources: SearchResult[];
    scrapedCount: number;
    loopsExecuted: number;
    durationMs: number;
}): ResearchMetrics {
    const { sources, scrapedCount, loopsExecuted, durationMs } = params;
    const domains = new Set<string>();
    for (const s of sources) {
        const d = extractDomain(s.url);
        if (d) domains.add(d);
    }
    const sourceCount = sources.length;
    const uniqueDomains = domains.size;
    return {
        sourceCount,
        uniqueDomains,
        sourceDiversity: sourceCount > 0 ? uniqueDomains / sourceCount : 0,
        scrapedCount,
        loopsExecuted,
        durationMs,
    };
}

export function clampImportance(value: number | undefined): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return 3;
    }
    return Math.max(1, Math.min(5, Math.round(value)));
}

/**
 * 주제 분해가 실패했을 때 쓰는 고정 템플릿 서브토픽.
 *
 * ⚠️ `topic` 은 **사용자 발화 원문**이라 그대로 검색어에 붙이면 지시문이 섞인다 — 2026-09-13
 * 라이브에서 "국내 전기버스 보급 현황을 아주 짧게 조사해줘. 개요" 같은 쿼리가 나가 보고서
 * 참고문헌에 무관한 문서(국어 연감·지진·게임 위키)가 실렸다. 검색어는 `cleanSearchQuery` 로
 * 지시문을 벗긴 주제어를 쓰고, 제목은 사용자에게 보이는 값이라 원문을 유지한다.
 */
export function buildFallbackSubTopics(topic: string): SubTopic[] {
    // 정제가 과하게 깎아 빈 값이 되면 cleanSearchQuery 가 원문을 돌려주므로 추가 폴백은 불필요
    const q = cleanSearchQuery(topic);
    const currentYear = new Date().getFullYear();
    return [
        {
            title: `${topic} 개요 및 정의`,
            searchQueries: [`${q} 개요`, `${q} 정의`, `${q} 배경`],
            importance: 5
        },
        {
            title: `${topic} 최신 동향`,
            searchQueries: [`${q} 최신 동향`, `${q} ${currentYear} 트렌드`, `${q} recent updates`],
            importance: 5
        },
        {
            title: `${topic} 기술/구조 분석`,
            searchQueries: [`${q} 구조`, `${q} architecture`, `${q} technical analysis`],
            importance: 4
        },
        {
            title: `${topic} 시장 및 산업 영향`,
            searchQueries: [`${q} 시장 규모`, `${q} 산업 영향`, `${q} market report`],
            importance: 4
        },
        {
            title: `${topic} 주요 사례`,
            searchQueries: [`${q} 사례`, `${q} case study`, `${q} 성공 사례`],
            importance: 4
        },
        {
            title: `${topic} 리스크와 한계`,
            searchQueries: [`${q} 한계`, `${q} 리스크`, `${q} 문제점`],
            importance: 3
        },
        {
            title: `${topic} 규제 및 정책`,
            searchQueries: [`${q} 규제`, `${q} 정책`, `${q} 법률`],
            importance: 3
        },
        {
            title: `${topic} 향후 전망`,
            searchQueries: [`${q} 전망`, `${q} future outlook`, `${q} 예측`],
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
