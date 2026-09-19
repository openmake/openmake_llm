/**
 * 웹 검색 언어 결정 — 호출자가 언어를 명시하지 않으면 질의 문자에서 감지한다.
 *
 * 배경(2026-08-29 실측): `performWebSearch` 의 language 기본값이 'en' 이라, 모델이 부르는
 * web_search/fact_check 도구·REST 경로처럼 언어를 안 넘기는 호출은 한국어 질의여도 네이버(뉴스·
 * 웹문서·백과)·다음 웹문서 4개 provider 가 아예 실행되지 않았다(2일 53건 중 47건 Naver:0).
 * 사전 검색(build-search-context)·deep-research 만 사용자 언어를 넘겨 정상이었다.
 *
 * @module mcp/web-search/search-language
 */
import { detectLanguage } from '../../chat/language-policy';

/** 명시 언어가 있으면 그대로, 없으면 질의에서 감지(한글 → 'ko', 라틴 텍스트는 'en' 폴백). */
export function resolveSearchLanguage(query: string, explicit?: string): string {
    if (explicit) return explicit;
    return detectLanguage(query).language;
}
