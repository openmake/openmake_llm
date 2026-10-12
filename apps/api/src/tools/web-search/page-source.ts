/**
 * 읽은 페이지 → 턴 출처 등록 (extract_webpage · web_scrape 공용).
 *
 * 모델이 직접 읽은 페이지에 번호가 없으면 그 내용을 인용할 때 검색 결과 번호를 빌려 쓴다(2026-10-12 로컬 라이브:
 * 읽은 공식 블로그를 [출처 1] 로 인용했는데 1번은 web_search 의 무관한 페이지). web_search 와 같은 번호 체계에 넣는다.
 *
 * @module mcp/web-search/page-source
 */
import type { UserContext } from '../../tool-contract/types';
import { WEB_SEARCH_TOOL_LIMITS } from '../../config/addon-tool-limits';
import { formatSearchSources, toSourceRefs } from './format-sources';
import type { SearchSourceRef } from './types';

/**
 * 읽은 페이지 1건에 턴 출처 번호를 준다 — 문맥의 sourceNumberBase 뒤 번호를 받고 기준을 1 민다.
 * 돌려주는 header 는 web_search 결과와 같은 표기(`[N] 제목\n   URL`)로, 도구 결과 텍스트 맨 앞에 붙여 모델이 번호를 알게 한다.
 * 기준이 없는 문맥(채팅 턴 밖 — 에이전트 작업 등)은 undefined — 호출부는 결과를 종전 그대로 둔다.
 * 결과가 나온 뒤(await 없는 구간)에 불러야 병렬 호출끼리 번호가 겹치지 않는다.
 */
export function registerPageSource(
    context: UserContext | undefined,
    page: { title?: string; url: string; text: string },
): { header: string; sources: SearchSourceRef[] } | undefined {
    if (context?.sourceNumberBase === undefined) return undefined;
    const numberOffset = context.sourceNumberBase;
    context.sourceNumberBase = numberOffset + 1;
    const entry = { title: page.title?.trim() || page.url, url: page.url, snippet: page.text };
    return {
        // 본문은 도구 결과에 이미 있으니 머리말에는 snippet 을 싣지 않는다
        header: formatSearchSources([{ ...entry, snippet: '' }], { numberOffset }),
        sources: toSourceRefs([entry], { maxSnippetChars: WEB_SEARCH_TOOL_LIMITS.SNIPPET_CHARS, snippetSuffix: '...', numberOffset }),
    };
}
