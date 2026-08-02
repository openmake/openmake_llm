/**
 * @module agents/discussion-sources
 * @description 토론 결과에 붙일 출처 목록 블록 생성 (2026-08-02).
 *
 * 토론에 Evidence Package 를 주입한 뒤에도 최종 답변에 출처가 드러나지 않았다
 * (라이브 확인: 근거는 반영되는데 URL 인용 0건). 원인은 채팅 경로에서 이미 겪은 것과
 * 같다 — qwen 이 프롬프트의 인용 지시를 자주 무시한다. 그래서 프롬프트가 아니라
 * 응답 조립부에서 결정적으로 붙인다(external-provider 의 웹검색 출처 첨부와 동일 패턴).
 */
import type { DiscussionSource } from './discussion-types';
import { WEB_SEARCH_TEMPLATES, getLocalizedTemplate } from '../sockets/ws-chat-locales';

/**
 * 도구 결과에 실어 보내는 출처 블록의 마커.
 *
 * 도구 경유 토론은 결과가 모델에게 도구 메시지로 전달되고 모델이 그것을 *요약*해
 * 최종 답변을 쓴다. 그래서 도구 결과에 출처를 넣어도 그대로 버려진다(라이브 확인 —
 * 카카오 지도 블록과 같은 선례). 마커로 감싸 두면 external-provider 가 이를 뽑아
 * 모델에게는 감추고 최종 응답에 정확히 1회 붙일 수 있다.
 */
export const DISCUSSION_SOURCES_MARKER_START = '[[discussion-sources]]';
export const DISCUSSION_SOURCES_MARKER_END = '[[/discussion-sources]]';

/** 마커로 감싼다(빈 블록이면 그대로 빈 문자열). */
export function wrapDiscussionSources(block: string): string {
    return block
        ? `\n${DISCUSSION_SOURCES_MARKER_START}${block}${DISCUSSION_SOURCES_MARKER_END}`
        : '';
}

/**
 * 도구 결과에서 출처 블록을 뽑아내고, 모델에게 보낼 텍스트에서는 제거한다.
 *
 * @returns blocks - 추출된 출처 블록들, modelFacing - 마커 구간을 걷어낸 텍스트
 */
export function extractDiscussionSources(toolResult: string): { blocks: string[]; modelFacing: string } {
    const re = /\[\[discussion-sources\]\]([\s\S]*?)\[\[\/discussion-sources\]\]/g;
    const blocks: string[] = [];
    for (const m of toolResult.matchAll(re)) {
        const body = (m[1] ?? '').trim();
        if (body && !blocks.includes(body)) blocks.push(body);
    }
    return { blocks, modelFacing: toolResult.replace(re, '').trimEnd() };
}

/** 이미 출처 섹션이 있는지 판정 — 모델이 직접 만든 경우 중복 첨부를 피한다. */
function alreadyHasSources(text: string, label: string): boolean {
    return new RegExp(`(^|\\n)\\s*(#{1,3}\\s*|\\*\\*\\s*)${label}`).test(text);
}

/**
 * 출처 목록 블록을 만든다. 붙일 것이 없으면 빈 문자열.
 *
 * @param answer - 최종 답변 본문 (중복 판정용)
 * @param sources - Evidence Package
 * @param lang - 사용자 언어 (라벨 현지화)
 */
export function buildDiscussionSourcesBlock(
    answer: string,
    sources: DiscussionSource[] | undefined,
    lang: string | undefined,
): string {
    if (!sources || sources.length === 0) return '';
    const label = getLocalizedTemplate(WEB_SEARCH_TEMPLATES, lang || 'en').sourceLabel;
    if (alreadyHasSources(answer, label)) return '';

    const entries: string[] = [];
    const seen = new Set<string>();
    for (const s of sources) {
        if (!s.url || seen.has(s.url)) continue;
        seen.add(s.url);
        entries.push(`${entries.length + 1}. [${s.title || s.url}](${s.url})`);
    }
    return entries.length > 0 ? `\n\n---\n\n**${label}**\n${entries.join('\n')}` : '';
}
