/**
 * ============================================================
 * Context XML Helpers - XML 태그 헬퍼 함수
 * ============================================================
 * 
 * context-engineering.ts에서 사용하는 XML 태그 래핑 함수를 분리한 모듈입니다.
 * xmlTag, systemRulesSection, contextSection, examplesSection, thinkingSection을 제공합니다.
 * 
 * @module chat/context-xml-helpers
 * @see chat/context-engineering - 이 헬퍼들을 사용하는 메인 모듈
 * @see chat/context-types - 타입 정의
 */

import { escapeXml } from './xml-escape';

// ============================================================
// XML 태그 헬퍼 함수
// ============================================================

/**
 * XML 태그로 콘텐츠 래핑
 * 
 * 🔒 Phase 2 보안 패치 2026-02-07: 프롬프트 인젝션 방어
 * escapeContent=true(기본값)일 때 사용자 입력의 XML 특수문자를 이스케이프하여
 * 프롬프트 인젝션 공격을 방지합니다.
 * 
 * @param tagName - XML 태그 이름
 * @param content - 태그 내부 콘텐츠
 * @param attributes - 태그 속성 (선택)
 * @param escapeContent - 콘텐츠 이스케이프 여부 (기본: true). 
 *        시스템 프롬프트 등 신뢰할 수 있는 내부 콘텐츠는 false로 설정
 */
export function xmlTag(
    tagName: string, 
    content: string, 
    attributes?: Record<string, string>,
    escapeContent: boolean = true
): string {
    const attrStr = attributes
        ? ' ' + Object.entries(attributes).map(([k, v]) => `${k}="${v}"`).join(' ')
        : '';
    const safeContent = escapeContent ? escapeXml(content) : content;
    return `<${tagName}${attrStr}>\n${safeContent}\n</${tagName}>`;
}

/**
 * 시스템 규칙 섹션 생성 (내부 콘텐츠 — 이스케이프 불필요)
 */
export function systemRulesSection(rules: string[]): string {
    const content = rules.map((rule, i) => `${i + 1}. ${rule}`).join('\n');
    return xmlTag('system_rules', content, undefined, false);
}

/**
 * 컨텍스트 섹션 생성 (RAG 결과 등)
 * 🔒 사용자 입력이 포함될 수 있으므로 이스케이프 적용
 */
export function contextSection(context: string): string {
    return xmlTag('context', context);
}

/**
 * 예시 섹션 생성 (Few-shot, 내부 콘텐츠 — 이스케이프 불필요)
 */
export function examplesSection(examples: Array<{ input: string; output: string }>): string {
    const content = examples.map((ex, i) =>
        `### 예시 ${i + 1}\n입력: ${ex.input}\n출력: ${ex.output}`
    ).join('\n\n');
    return xmlTag('examples', content, undefined, false);
}

/**
 * 사고 과정 섹션 (Soft Interlock)
 */
export function thinkingSection(): string {
    return `<thinking>
[이 섹션에서 문제를 분석하고 답변 전략을 수립하세요]
1. 문제 분석: 사용자가 무엇을 요구하는가?
2. 접근 전략: 어떤 방법으로 해결할 것인가?
3. 안전성 검증: 이 답변이 안전한가?
4. 출력 계획: 어떤 형식으로 제공할 것인가?
</thinking>`;
}
