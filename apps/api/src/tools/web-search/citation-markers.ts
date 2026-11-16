/**
 * 본문의 라벨 인용 마커 정의 — 채팅 후처리(external-deterministic-append)와 근거 게이트가 같은 꼴을 읽는다.
 * 웹 `apps/web/lib/citations.ts` 의 `LABELED_CITE_RE` 와 짝이다(짝 검사: `__tests__/web/citations.test.ts`).
 *
 * @module tools/web-search/citation-markers
 */
import { WEB_SEARCH_TEMPLATES } from '../../sockets/ws-chat-locales';

/** 7개 언어 sourceLabel 의 정규식 alternation (중복 제거·이스케이프) — 템플릿이 SoT */
export const SOURCE_LABEL_ALT = [...new Set(Object.values(WEB_SEARCH_TEMPLATES).map((t) => t.sourceLabel))]
    .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
/**
 * 라벨 인용 마커 소스 — `[출처 3]`·`[Source 1, 2]`·`[출처 11, 출처 16]`(번호마다 라벨) 형태.
 * 라벨 없는 `[3]` 은 각주/코드 오탐 위험으로 제외.
 */
export const CITATION_MARKER_SRC = `\\[\\s*(?:${SOURCE_LABEL_ALT})\\s*\\d+(?:\\s*[,·、]\\s*(?:(?:${SOURCE_LABEL_ALT})\\s*)?\\d+)*\\s*\\]`;
