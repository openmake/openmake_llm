/**
 * ============================================================
 * Web Search Context Builder — 웹검색 → system 주입용 컨텍스트 문자열
 * ============================================================
 *
 * ws-chat-handler 의 pre-chat 웹검색 블록을 공유 헬퍼로 추출. 동일 로직을 여러
 * 경로(WS 채팅, REST /api/chat/structured)가 재사용해 "한 경로만 웹검색이 되고
 * 다른 경로는 안 되는" 분기 누락 버그를 방지한다.
 *
 * 동작(원본과 동일):
 *  1. 시사(current-events) 질의 감지 — 언어별 + 영어 키워드.
 *  2. 사용자가 명시적으로 끄지 않았고 (webSearchEnabled || 시사질의) 이면 검색 수행.
 *  3. 결과를 WEB_SEARCH_INJECTION 캡으로 포맷해 컨텍스트 문자열 생성.
 *  4. 시사질의인데 외부 데이터 0건이면 환각 방지 안전망 문구 주입.
 *
 * @module mcp/web-search/build-search-context
 */
import { performWebSearch } from './search-orchestrator';
import { cleanSearchQuery } from './query-cleaner';
import { formatSearchSources } from './format-sources';
import { WEB_SEARCH_INJECTION } from '../../config/runtime-limits';
import { getStaleDataWarning } from '../../config/stale-data-warning';
import {
    CURRENT_EVENTS_KEYWORDS,
    WEB_SEARCH_TEMPLATES,
    getLocalizedTemplate,
} from '../../sockets/ws-chat-locales';
import { createLogger } from '../../utils/logger';

const logger = createLogger('WebSearchContext');

export interface BuildWebSearchContextResult {
    /** system 채널에 주입할 웹검색 컨텍스트 문자열 (없으면 ''). */
    webSearchContext: string;
    /** 시사 질의로 감지되었는지 여부. */
    isCurrentEventsQuery: boolean;
}

/**
 * 웹검색을 수행하고 LLM 주입용 컨텍스트 문자열을 만든다.
 */
export async function buildWebSearchContext(opts: {
    message: string;
    userLang: string;
    /** 사용자 웹검색 토글 (UI webSearch=true). */
    webSearchEnabled: boolean;
    /** enabledTools.web_search === false 처럼 명시적으로 끈 경우. */
    explicitlyDisabled?: boolean;
    signal?: AbortSignal;
}): Promise<BuildWebSearchContextResult> {
    const { message, userLang, webSearchEnabled, explicitlyDisabled = false, signal } = opts;

    const langKeywords = getLocalizedTemplate(CURRENT_EVENTS_KEYWORDS, userLang);
    const allKeywords = [...langKeywords, ...(CURRENT_EVENTS_KEYWORDS['en'] || [])];
    const lowerMessage = message?.toLowerCase() ?? '';
    const isCurrentEventsQuery = allKeywords.some(
        (keyword) => lowerMessage.includes(keyword.toLowerCase()),
    );

    let webSearchContext = '';

    if (!explicitlyDisabled && (webSearchEnabled || isCurrentEventsQuery)) {
        try {
            const searchQuery = cleanSearchQuery(message);
            const searchResults = await performWebSearch(searchQuery, {
                maxResults: WEB_SEARCH_INJECTION.COLLECT_MAX_RESULTS,
                language: userLang,
                preferRecent: isCurrentEventsQuery,
                signal,
            });
            if (searchResults.length > 0) {
                const tpl = getLocalizedTemplate(WEB_SEARCH_TEMPLATES, userLang);
                const body = formatSearchSources(searchResults, {
                    maxResults: WEB_SEARCH_INJECTION.MAX_RESULTS,
                    maxSnippetChars: WEB_SEARCH_INJECTION.MAX_SNIPPET_CHARS,
                    labeled: true,
                    sourceWord: tpl.sourceLabel,
                    contentWord: tpl.contentLabel,
                    separator: '\n',
                });
                webSearchContext = `\n\n## 🔍 ${tpl.header} (${new Date().toLocaleDateString(tpl.locale)} )\n` +
                    `${tpl.instruction}\n\n${body}\n`;
            }
        } catch (e) {
            // 클라이언트 중단(abort)은 삼키지 않고 전파 — 이미 끊긴 signal 로 LLM 을 호출해
            // 헛된 upstream 요청·spurious 500 을 내는 것을 막는다. (호출부가 깔끔히 취소 처리)
            if (signal?.aborted || (e instanceof Error && e.name === 'AbortError')) throw e;
            logger.error('웹 검색 실패:', e);
        }
    }

    // 시사 질의인데 외부 데이터를 얻지 못한 경우 환각 방지 안전망 주입.
    if (isCurrentEventsQuery && !webSearchContext) {
        const warning = getStaleDataWarning(userLang);
        webSearchContext = `\n\n## ⚠️ ${warning.header}\n${warning.instruction}\n`;
    }

    return { webSearchContext, isCurrentEventsQuery };
}
