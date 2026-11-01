/**
 * ============================================================
 * Context XML Helpers - XML 태그 헬퍼 함수
 * ============================================================
 * 
 * context-engineering.ts에서 사용하는 XML 태그 래핑 함수를 분리한 모듈입니다.
 * xmlTag, examplesSection을 제공합니다.
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
 * 예시 섹션 생성 (Few-shot, 내부 콘텐츠 — 이스케이프 불필요)
 */
export function examplesSection(examples: Array<{ input: string; output: string }>): string {
    const content = examples.map((ex, i) =>
        `### 예시 ${i + 1}\n입력: ${ex.input}\n출력: ${ex.output}`
    ).join('\n\n');
    return xmlTag('examples', content, undefined, false);
}
