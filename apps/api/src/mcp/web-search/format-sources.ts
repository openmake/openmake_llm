/**
 * 검색 결과 → LLM 컨텍스트/프롬프트 주입용 문자열 포맷터 (단일 지점).
 *
 * 기존에 ws-chat-handler · web-search.routes · createFactCheckPrompt · tools 4곳에
 * 동일한 `[N] title/URL/snippet` 포맷이 중복돼, 주입 캡(결과 수·snippet 길이)이 한 곳에만
 * 적용되는 불일치가 있었다. 이 헬퍼로 포맷과 캡 정책을 한 곳에서 관리한다.
 *
 * @module mcp/web-search/format-sources
 */
import type { SearchResult } from './types';

export interface FormatSourcesOptions {
    /** 주입할 상위 결과 수 (0/미지정 = 무제한) */
    maxResults?: number;
    /** 결과당 snippet 최대 글자 수 (0/미지정 = 무제한) */
    maxSnippetChars?: number;
    /** true: `[출처 N] … URL: … 내용: …` 라벨형 / false: `[N] … url … snippet` 간결형 */
    labeled?: boolean;
    /** 라벨형의 출처 단어 (기본 '출처', 다국어 라벨 전달용) */
    sourceWord?: string;
    /** 라벨형의 내용 단어 (기본 '내용', 다국어 라벨 전달용) */
    contentWord?: string;
    /** 항목 구분자 (기본 '\n\n') */
    separator?: string;
    /** snippet 이 빈 경우 표시 텍스트 (기본 '') */
    emptySnippet?: string;
    /** 간결형에서 snippet 뒤에 붙일 접미사 (예: '...') */
    snippetSuffix?: string;
}

type SourceLike = Pick<SearchResult, 'title' | 'url' | 'snippet'>;

/** 검색 결과 배열을 주입용 문자열로 포맷 (결과 수·snippet 길이 캡 적용). */
export function formatSearchSources(results: SourceLike[], opts: FormatSourcesOptions = {}): string {
    const {
        maxResults = 0,
        maxSnippetChars = 0,
        labeled = false,
        sourceWord = '출처',
        contentWord = '내용',
        separator = '\n\n',
        emptySnippet = '',
        snippetSuffix = '',
    } = opts;

    const limited = maxResults > 0 ? results.slice(0, maxResults) : results;
    const lines = limited.map((r, i) => {
        let snip = r.snippet || '';
        // code point 기준 컷 — UTF-16 code unit slice 는 이모지(surrogate pair) 중간을
        // 잘라 lone surrogate/replacement char 를 남긴다. [...str] 는 code point 이터레이터.
        if (maxSnippetChars > 0 && [...snip].length > maxSnippetChars) {
            snip = [...snip].slice(0, maxSnippetChars).join('') + snippetSuffix;
        } else if (snip && snippetSuffix) {
            snip = snip + snippetSuffix;
        }
        const tag = labeled ? `[${sourceWord} ${i + 1}]` : `[${i + 1}]`;
        const urlLine = labeled ? `   URL: ${r.url}` : `   ${r.url}`;
        // 라벨형이라도 내용이 비면 빈 "내용: " 라벨을 출력하지 않는다(누수 방지).
        const contentText = snip || emptySnippet;
        const contentLine = labeled
            ? (contentText ? `\n   ${contentWord}: ${contentText}` : '')
            : (snip ? `\n   ${snip}` : '');
        return `${tag} ${r.title}\n${urlLine}${contentLine}`;
    });
    return lines.join(separator);
}
