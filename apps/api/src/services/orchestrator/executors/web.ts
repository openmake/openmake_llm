/**
 * @module services/orchestrator/executors/web
 * @description web.search — 기존 검색 오케스트레이터(SearXNG·네이버·구글 등)를 함수로 호출해 결과 요약 텍스트를 만든다.
 * 모델 배정 없음(capability_models 대상 아님).
 */
import { ORCHESTRATOR } from '../../../config/capabilities';
import { performWebSearch } from '../../../mcp/web-search/search-orchestrator';
import type { CapabilityExecutor } from '../types';

const MAX_RESULTS = 8;

export const webSearchExecutor: CapabilityExecutor = async (task, ctx) => {
    const query = (task.instruction || ctx.userMessage).trim();
    if (!query) throw new Error('web.search: 검색어가 없습니다');
    const results = await performWebSearch(query, { maxResults: MAX_RESULTS, language: ctx.lang, signal: ctx.signal, preferRecent: true });
    if (results.length === 0) {
        return { ok: true, text: ctx.lang === 'ko' ? `"${query}" 검색 결과 없음` : `No results for "${query}"`, media: [] };
    }
    const lines = results.slice(0, MAX_RESULTS).map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${(r.snippet || '').replace(/\s+/g, ' ').slice(0, 300)}`);
    const text = `${ctx.lang === 'ko' ? '검색어' : 'Query'}: ${query}\n${lines.join('\n')}`;
    return { ok: true, text: text.slice(0, ORCHESTRATOR.RESULT_MAX_CHARS), media: [] };
};
